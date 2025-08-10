import Parser from "rss-parser";

// Define the structure of a Reddit post
export interface RedditPost {
	id: string;
	title: string;
	link: string;
	contentSnippet: string;
	pubDate?: string;
	author: string;
}

// Create a new RSS parser instance
const parser = new Parser({
	customFields: {
		item: ["author", "id"],
	},
	timeout: 5000,
});

/**
 * Fetch top posts from a Reddit subreddit
 * @param subreddit - The subreddit to fetch posts from (default: 'all')
 * @param limit - Maximum number of posts to fetch (default: 5)
 * @returns An array of Reddit posts
 */
export async function fetchRedditTopPosts(
	subreddit: string = "all",
	limit: number = 5,
): Promise<RedditPost[]> {
	try {
		const feedUrl = `https://www.reddit.com/r/${subreddit}/top/.rss`;

		// Fetch the RSS feed
		const feed = await parser.parseURL(feedUrl);

		// Process and return the posts
		return feed.items.slice(0, limit).map((item) => ({
			id: item.id,
			title: item.title || "",
			link: item.link || "",
			contentSnippet: item.contentSnippet || "",
			pubDate: item.pubDate,
			author: item.author,
		}));
	} catch (error) {
		console.error("Error fetching Reddit posts:", error);
		return [];
	}
}

/**
 * Trim the title portion from Reddit URLs to make them shorter
 * @param url - The Reddit URL to trim
 * @returns The trimmed URL without the title portion
 */
export function trimRedditUrl(url: string): string {
	// Match Reddit URL pattern: https://[subdomain.]reddit.com/r/[subreddit]/comments/[post_id]/[title]/
	const redditUrlPattern =
		/^(https?:\/\/(?:\w+\.)?reddit\.com\/r\/\w+\/comments\/\w+)\/.*/;
	const match = url.match(redditUrlPattern);

	if (match) {
		return match[1]; // Return everything up to the post ID
	}

	return url; // Return original URL if it doesn't match the pattern
}

/**
 * Format a Reddit post as a readable message
 * @param post - The Reddit post to format
 * @returns A formatted string for the post
 */
export function formatRedditPost(post: RedditPost): string {
	const trimmedLink = trimRedditUrl(post.link);
	return `📰 ${post.title}
🔗 Link: ${trimmedLink}
${post.pubDate ? `⏰ Published: ${new Date(post.pubDate).toUTCString()}` : ""}`;
}
