import { Client } from "@xmtp/node-sdk";
import type { RedditPost } from "./reddit-service";
import { formatRedditPost } from "./reddit-service";
import { FifoSet } from "./fifo-set";
import fs from "node:fs";
import path from "node:path";

interface UserData {
  subscriptions: { [address: string]: string[] };
  seenPosts: { [subreddit: string]: string[] };
}

export class ConversationManager {
  private client: Client;
  private seenPostsBySubreddit: Map<string, FifoSet<string>> = new Map(); // subreddit -> seen post IDs
  private userSubscriptions: Map<string, Set<string>> = new Map(); // address -> subreddits
  private dataFilePath: string;

  constructor(client: Client, dataDir: string) {
    this.client = client;
    // Create a file to persist user data
    this.dataFilePath = `./${dataDir}/user_data.json`;
    this.loadUserData();
  }

  /**
   * Load user data from file
   */
  private loadUserData() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Create file if it doesn't exist
      if (!fs.existsSync(this.dataFilePath)) {
        const initialData: UserData = { 
          subscriptions: {},
          seenPosts: {}
        };
        fs.writeFileSync(this.dataFilePath, JSON.stringify(initialData));
        return;
      }
      
      // Load user data
      const data: UserData = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf8'));
      
      // Load user subscriptions
      if (data.subscriptions) {
        Object.entries(data.subscriptions).forEach(([address, subreddits]) => {
          const lowerAddress = address.toLowerCase();
          this.userSubscriptions.set(lowerAddress, new Set(subreddits));
        });
      }
      
      // Load seen posts
      if (data.seenPosts) {
        Object.entries(data.seenPosts).forEach(([subreddit, postIds]) => {
          const normalizedSubreddit = subreddit.toLowerCase();
          this.seenPostsBySubreddit.set(normalizedSubreddit, FifoSet.deserialize(postIds, 1000));
        });
      }
      
      console.log(`Loaded ${this.userSubscriptions.size} user subscriptions and ${this.seenPostsBySubreddit.size} subreddit seen post lists`);
    } catch (error) {
      console.error("Failed to load user data:", error);
    }
  }

  /**
   * Save user data to file
   */
  private saveUserData() {
    try {
      const subscriptionsObj: { [address: string]: string[] } = {};
      this.userSubscriptions.forEach((subreddits, address) => {
        subscriptionsObj[address] = Array.from(subreddits);
      });
      
      const seenPostsObj: { [subreddit: string]: string[] } = {};
      this.seenPostsBySubreddit.forEach((fifoSet, subreddit) => {
        seenPostsObj[subreddit] = fifoSet.serialize();
      });
      
      const data: UserData = {
        subscriptions: subscriptionsObj,
        seenPosts: seenPostsObj
      };
      
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Failed to save user data:", error);
    }
  }

  /**
   * Get all existing conversations
   */
  async getAllConversations() {
    return await this.client.conversations.list();
  }

  /**
   * Unsubscribe a user from all subreddits
   * @param address The wallet address
   * @returns true if had subscriptions, false if no subscriptions
   */
  unsubscribeFromAllSubreddits(address: string): boolean {
    const lowerCaseAddress = address.toLowerCase();
    const userSubs = this.userSubscriptions.get(lowerCaseAddress);
    
    if (!userSubs || userSubs.size === 0) {
      return false;
    }
    
    const subredditCount = userSubs.size;
    this.userSubscriptions.delete(lowerCaseAddress);
    this.saveUserData();
    console.log(`Address ${address} unsubscribed from all ${subredditCount} subreddits`);
    return true;
  }

  /**
   * Send a Reddit post to subscribers of a specific subreddit
   * @param post - The Reddit post to send
   * @param subreddit - The subreddit the post is from
   * @returns true if the post was sent, false if it was already sent
   */
  async sendRedditPostToSubscribers(post: RedditPost, subreddit: string): Promise<boolean> {    
    const normalizedSubreddit = subreddit.toLowerCase();
    
    // Get or create FifoSet for this subreddit
    if (!this.seenPostsBySubreddit.has(normalizedSubreddit)) {
      this.seenPostsBySubreddit.set(normalizedSubreddit, new FifoSet<string>(50));
    }
    const seenPosts = this.seenPostsBySubreddit.get(normalizedSubreddit)!;
    
    // Skip if we've already sent this post
    if (seenPosts.has(post.id)) {
      return false;
    }
    
    // Add to seen posts for this subreddit
    seenPosts.add(post.id);
    this.saveUserData();

    // Get subscribers for this subreddit
    const subscribers = this.getSubscribersForSubreddit(subreddit);
    
    if (subscribers.length === 0) {
      console.log(`No subscribers for r/${subreddit}, skipping post`);
      return false;
    }
    
    // Format the post and send to subscribers
    const formattedPost = formatRedditPost(post);
    await this.sendToSpecificAddresses(formattedPost, subscribers);
    
    return true;
  }

  /**
   * Send a message to specific addresses
   * @param message - The message to send
   * @param addresses - Array of addresses to send to
   */
  async sendToSpecificAddresses(message: string, addresses: string[]) {
    const conversations = await this.getAllConversations();
    console.log(`Sending message to ${addresses.length} specific addresses...`);
    
    let sentCount = 0;
    let skippedCount = 0;

    for (const conversation of conversations) {
      try {
        const address = await this.getAddressFromConversation(conversation);
        
        // Only send to addresses in our list
        if (!addresses.includes(address.toLowerCase())) {
          skippedCount++;
          continue;
        }
        
        const id = await conversation.send(message);
        console.log(`Message sent to ${address}: ${id}`);
        sentCount++;
      } catch (error) {
        console.error(`Failed to send message to conversation:`, error);
      }
    }
    
    console.log(`Send complete: ${sentCount} messages sent, ${skippedCount} skipped`);
  }

  /**
   * Extract the wallet address from a conversation
   */
  private async getAddressFromConversation(conversation: any): Promise<string> {
    try {
      const peerAddress = conversation.peerAddress;
      if (peerAddress) return peerAddress;
      
      // If we don't have the peer address directly, try to get it from inbox state
      const inboxState = await this.client.preferences.inboxStateFromInboxIds([
        conversation.peerInboxId,
      ]);
      
      if (inboxState && inboxState[0]?.identifiers[0]?.identifier) {
        return inboxState[0].identifiers[0].identifier;
      }
      
      return "unknown-address";
    } catch (error) {
      console.error("Failed to get address from conversation:", error);
      return "unknown-address";
    }
  }

  /**
   * Subscribe a user to a subreddit
   * @param address The wallet address
   * @param subreddit The subreddit name
   * @returns true if newly subscribed, false if already subscribed
   */
  subscribeToSubreddit(address: string, subreddit: string): boolean {
    const lowerCaseAddress = address.toLowerCase();
    const normalizedSubreddit = subreddit.toLowerCase();
    
    if (!this.userSubscriptions.has(lowerCaseAddress)) {
      this.userSubscriptions.set(lowerCaseAddress, new Set());
    }
    
    const userSubs = this.userSubscriptions.get(lowerCaseAddress)!;
    if (userSubs.has(normalizedSubreddit)) {
      return false;
    }
    
    userSubs.add(normalizedSubreddit);
    this.saveUserData();
    console.log(`Address ${address} subscribed to r/${subreddit}`);
    return true;
  }

  /**
   * Unsubscribe a user from a subreddit
   * @param address The wallet address
   * @param subreddit The subreddit name
   * @returns true if unsubscribed, false if not subscribed
   */
  unsubscribeFromSubreddit(address: string, subreddit: string): boolean {
    const lowerCaseAddress = address.toLowerCase();
    const normalizedSubreddit = subreddit.toLowerCase();
    
    const userSubs = this.userSubscriptions.get(lowerCaseAddress);
    if (!userSubs || !userSubs.has(normalizedSubreddit)) {
      return false;
    }
    
    userSubs.delete(normalizedSubreddit);
    if (userSubs.size === 0) {
      this.userSubscriptions.delete(lowerCaseAddress);
    }
    
    this.saveUserData();
    console.log(`Address ${address} unsubscribed from r/${subreddit}`);
    return true;
  }

  /**
   * Get all subreddits a user is subscribed to
   * @param address The wallet address
   * @returns Array of subreddit names
   */
  getUserSubscriptions(address: string): string[] {
    const lowerCaseAddress = address.toLowerCase();
    const userSubs = this.userSubscriptions.get(lowerCaseAddress);
    return userSubs ? Array.from(userSubs) : [];
  }

  /**
   * Get all unique subreddits that have subscribers
   * @returns Array of subreddit names
   */
  getAllSubscribedSubreddits(): string[] {
    const allSubs = new Set<string>();
    this.userSubscriptions.forEach(userSubs => {
      userSubs.forEach(sub => allSubs.add(sub));
    });
    return Array.from(allSubs);
  }

  /**
   * Get all users subscribed to a specific subreddit
   * @param subreddit The subreddit name
   * @returns Array of addresses
   */
  getSubscribersForSubreddit(subreddit: string): string[] {
    const normalizedSubreddit = subreddit.toLowerCase();
    const subscribers: string[] = [];
    
    this.userSubscriptions.forEach((userSubs, address) => {
      if (userSubs.has(normalizedSubreddit)) {
        subscribers.push(address);
      }
    });
    
    return subscribers;
  }
}
