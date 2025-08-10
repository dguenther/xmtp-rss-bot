import {
  createSigner,
  getEncryptionKeyFromHex,
  logAgentDetails,
  validateEnvironment,
} from "./src/client";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { fetchRedditTopPosts, formatRedditPost } from "./src/reddit-service";
import { ConversationManager } from "./src/conversation-manager";

/* Get the wallet key associated to the public key of
 * the agent and the encryption key for the local db
 * that stores your agent's messages */
const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV, POST_INTERVAL, POST_LIMIT, DATA_DIR } = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY",
  "XMTP_ENV",
  "POST_INTERVAL",
  "POST_LIMIT",
  "DATA_DIR",
]);

/* Create the signer using viem and parse the encryption key for the local db */
const signer = createSigner(WALLET_KEY);
const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

async function main() {
  const client = await Client.create(signer, {
    dbEncryptionKey,
    env: XMTP_ENV as XmtpEnv,
    dbPath: `./${DATA_DIR}/xmtp.db`,
  });
  void logAgentDetails(client);
  
  const conversationManager = new ConversationManager(client, DATA_DIR);
  
  // Set default values for configuration
  const postIntervalMinutes = parseInt(POST_INTERVAL || "60", 10);
  const postLimit = parseInt(POST_LIMIT || "5", 10);
  
  console.log(`✓ Ready to handle Reddit subscriptions`);
  console.log(`✓ Will check for new posts every ${postIntervalMinutes} minutes`);
  console.log(`✓ Will fetch up to ${postLimit} posts at a time`);

  // Set up periodic check for new Reddit posts
  async function checkAndSendRedditPosts() {
    try {
      const subscribedSubreddits = conversationManager.getAllSubscribedSubreddits();
      
      if (subscribedSubreddits.length === 0) {
        console.log("No active subreddit subscriptions, skipping periodic check");
        return;
      }
      
      console.log(`Checking for posts from ${subscribedSubreddits.length} subscribed subreddits...`);
      
      for (const subreddit of subscribedSubreddits) {
        try {
          console.log(`Fetching posts from r/${subreddit}...`);
          const posts = await fetchRedditTopPosts(subreddit, postLimit);
          
          if (posts.length === 0) {
            console.log(`No posts found for r/${subreddit}`);
            continue;
          }
          
          console.log(`Found ${posts.length} posts from r/${subreddit}, sending to subscribers...`);
          
          for (const post of posts) {
            const sent = await conversationManager.sendRedditPostToSubscribers(post, subreddit);
            if (sent) {
              console.log(`Sent post from r/${subreddit}: ${post.title}`);
            } else {
              console.log(`Skipped already sent post from r/${subreddit}: ${post.title}`);
            }
          }
        } catch (error) {
          console.error(`Error fetching posts from r/${subreddit}:`, error);
        }
      }
    } catch (error) {
      console.error("Error in periodic Reddit post check:", error);
    }
  }
  
  // Run immediately on startup
  await checkAndSendRedditPosts();
  
  // Set up interval for periodic checks (in milliseconds)
  const intervalMs = postIntervalMinutes * 60 * 1000;
  setInterval(checkAndSendRedditPosts, intervalMs);

  // Also continue to listen for incoming messages
  console.log("Waiting for messages...");
  const stream = await client.conversations.streamAllMessages();

  for await (const message of stream) {
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    const conversation = await client.conversations.getConversationById(
      message.conversationId,
    );

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    const inboxState = await client.preferences.inboxStateFromInboxIds([
      message.senderInboxId,
    ]);
    const addressFromInboxId = inboxState[0].identifiers[0].identifier;

    // Extract the text content
    const textContent = message.content as string;
    const lowerCaseText = textContent.toLowerCase().trim();
    console.log(`Received message from ${addressFromInboxId}: ${textContent}`);

    // Handle stop command
    if (lowerCaseText === "stop") {
      const hadSubscriptions = conversationManager.unsubscribeFromAllSubreddits(addressFromInboxId);
      if (hadSubscriptions) {
        await conversation.send("You have been unsubscribed from all subreddits and will no longer receive Reddit posts.");
      } else {
        await conversation.send("You weren't subscribed to any subreddits.");
      }
      continue;
    }



    // Handle messages containing keywords for Reddit content
    if (lowerCaseText.startsWith("reddit")) {
      const parts = lowerCaseText.split(" ");
      
      if (parts.length === 1) {
        // Just "reddit" - show user's subscriptions
        const userSubs = conversationManager.getUserSubscriptions(addressFromInboxId);
        if (userSubs.length === 0) {
          await conversation.send(`You're not subscribed to any subreddits yet. Use "reddit <subreddit>" to subscribe to a subreddit. For example: "reddit games"`);
        } else {
          await conversation.send(`You're subscribed to: ${userSubs.map(sub => `r/${sub}`).join(", ")}\n\nTo get posts from a specific subreddit, use "reddit <subreddit>"`);
        }
      } else if (parts.length === 2) {
        const subreddit = parts[1];
        
        // Check if user is subscribed to this subreddit
        const userSubs = conversationManager.getUserSubscriptions(addressFromInboxId);
        const isSubscribed = userSubs.includes(subreddit.toLowerCase());

        if (!isSubscribed) {
          // Subscribe them and send recent posts
          conversationManager.subscribeToSubreddit(addressFromInboxId, subreddit);
          await conversation.send(`✅ Subscribed to r/${subreddit}! You'll now receive new posts from this subreddit.\n\nHere are some recent posts:`);
        }

        // Send recent posts from this subreddit
        console.log(`Sending recent Reddit posts from r/${subreddit} to ${addressFromInboxId}...`);
        const posts = await fetchRedditTopPosts(subreddit, postLimit);

        if (posts.length > 0) {
          for (const post of posts) {
            const formattedPost = formatRedditPost(post);
            await conversation.send(formattedPost);
            console.log(`Sent post from r/${subreddit}: ${post.title}`);
          }
        } else {
          await conversation.send(`Sorry, I couldn't fetch any posts from r/${subreddit} at the moment.`);
        }
      } else {
        await conversation.send(`To use Reddit commands:\n- "reddit" to see your subscriptions\n- "reddit <subreddit>" to subscribe and get posts\n- "unsubscribe <subreddit>" to unsubscribe`);
      }
    } else if (lowerCaseText.startsWith("unsubscribe")) {
      const parts = lowerCaseText.split(" ");

      if (parts.length === 2) {
        const subreddit = parts[1];
        const wasUnsubscribed = conversationManager.unsubscribeFromSubreddit(addressFromInboxId, subreddit);
        
        if (wasUnsubscribed) {
          await conversation.send(`✅ Unsubscribed from r/${subreddit}. You'll no longer receive posts from this subreddit.`);
        } else {
          await conversation.send(`You weren't subscribed to r/${subreddit}.`);
        }
      } else {
        await conversation.send(`Use "unsubscribe <subreddit>" to unsubscribe from a subreddit. For example: "unsubscribe games"`);
      }
    } else {
      // Send help message for unknown commands
      await conversation.send(`Sorry, I don't understand that command. Try these commands:
- Send "reddit" to see your subscriptions
- Send "reddit <subreddit>" to subscribe and get posts (e.g., "reddit games")
- Send "unsubscribe <subreddit>" to unsubscribe from a subreddit
- Send "stop" to unsubscribe from all subreddits`);
    }
  }
}

main().catch(console.error);
