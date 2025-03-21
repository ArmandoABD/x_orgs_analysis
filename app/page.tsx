"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

interface Tweet {
  id: string;
  author_id: string;
  text: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

interface User {
  id: string;
  username: string;
  name: string;
  created_at: string;
  profile_image_url?: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
}

interface ApiResponse {
  data?: Tweet[];
  includes?: {
    users?: User[];
  };
  meta?: {
    result_count: number;
    next_token?: string;
  };
  errors?: any[];
}

interface UserResponse {
  data?: User;
  errors?: any[];
}

interface SentimentAnalysis {
  overall: {
    sentiment: string;
    scores: {
      negative: number;
      neutral: number;
      positive: number;
    };
  };
  individual: Array<{
    text: string;
    sentiment: string;
    scores: {
      negative: number;
      neutral: number;
      positive: number;
    };
  }>;
}

export default function Home() {
  // State variables
  const [username, setUsername] = useState<string>("Tesla");
  const [user, setUser] = useState<User | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllTweets, setShowAllTweets] = useState<boolean>(false);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [token, setToken] = useState<string>("");
  const [sentimentAnalysis, setSentimentAnalysis] = useState<SentimentAnalysis | null>(null);

  // Fetch user info and tweets on initial load
  useEffect(() => {
    const initApp = async () => {
      const isHealthy = await checkBackendHealth();
      if (isHealthy && username === "Tesla") {
        lookupUser();
      } else if (!isHealthy) {
        setError("Cannot connect to backend server. Please make sure it's running on http://localhost:8000");
      }
    };
    
    initApp();
  }, []);

  // Add a delay function
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Function to lookup a user by username
  const lookupUser = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Lookup user
      const userResponse = await fetch(`http://localhost:8000/users/by/username/${username}`, {
        headers: {
          "Authorization": "Bearer dummy-token"
        }
      });
      
      if (!userResponse.ok) {
        throw new Error(`API error: ${userResponse.status}`);
      }
      
      const userData: UserResponse = await userResponse.json();
      
      if (userData.errors) {
        throw new Error(userData.errors[0]?.detail || "Error looking up user");
      }
      
      if (!userData.data) {
        throw new Error("No user data returned");
      }
      
      setUser(userData.data);
      
      // Add a delay before fetching tweets to avoid rate limits
      await delay(1000);
      
      // Fetch tweets for this user
      await fetchTweets(userData.data.id);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch tweets for a user
  const fetchTweets = async (userId: string, paginationToken?: string) => {
    if (!paginationToken) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    
    try {
      // Build query parameters
      const params = new URLSearchParams();
      params.append("max_results", showAllTweets ? "100" : "5");
      params.append("exclude", "replies,retweets");
      params.append("tweet.fields", "created_at,public_metrics");
      params.append("expansions", "author_id");
      params.append("user.fields", "username,profile_image_url,public_metrics,description");
      
      if (paginationToken) {
        params.append("pagination_token", paginationToken);
      }
      
      // Fetch tweets
      const response = await fetch(`http://localhost:8000/users/${userId}/tweets?${params.toString()}`, {
        headers: {
          "Authorization": "Bearer dummy-token"
        }
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data: ApiResponse = await response.json();
      
      if (data.errors) {
        // Check if it's a rate limit error
        const isRateLimit = data.errors.some(err => 
          err.title === "Too Many Requests" || err.status === 429
        );
        
        if (isRateLimit) {
          throw new Error("Twitter API rate limit exceeded. Please try again in a few minutes.");
        } else {
          throw new Error(data.errors[0]?.detail || "Error fetching tweets");
        }
      }
      
      if (data.data) {
        if (paginationToken) {
          const newTweets = [...tweets, ...data.data!];
          setTweets(newTweets);
          // Analyze sentiment of the first 5 tweets
          await analyzeSentiment(newTweets.slice(0, 5));
        } else {
          setTweets(data.data);
          // Analyze sentiment of the first 5 tweets
          await analyzeSentiment(data.data.slice(0, 5));
        }
      }
      
      // Save next token for pagination
      setNextToken(data.meta?.next_token || null);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Function to load more tweets
  const loadMoreTweets = () => {
    if (user && nextToken) {
      fetchTweets(user.id, nextToken);
    }
  };

  // Function to toggle between showing 5 or 100 tweets
  const toggleTweetView = async () => {
    if (user) {
      setShowAllTweets(!showAllTweets);
      
      // Only fetch new data if we're switching to "show all" and don't have enough tweets
      if (!showAllTweets && tweets.length < 100) {
        setTweets([]);
        setNextToken(null);
        await fetchTweets(user.id);
      }
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Calculate engagement metrics
  const calculateEngagement = (tweets: Tweet[]) => {
    if (!tweets.length || !tweets[0].public_metrics) return null;
    
    let totalLikes = 0;
    let totalRetweets = 0;
    let totalReplies = 0;
    let totalQuotes = 0;
    
    tweets.forEach(tweet => {
      if (tweet.public_metrics) {
        totalLikes += tweet.public_metrics.like_count;
        totalRetweets += tweet.public_metrics.retweet_count;
        totalReplies += tweet.public_metrics.reply_count;
        totalQuotes += tweet.public_metrics.quote_count;
      }
    });
    
    const avgLikes = totalLikes / tweets.length;
    const avgRetweets = totalRetweets / tweets.length;
    const avgReplies = totalReplies / tweets.length;
    const avgQuotes = totalQuotes / tweets.length;
    
    return {
      totalLikes,
      totalRetweets,
      totalReplies,
      totalQuotes,
      avgLikes,
      avgRetweets,
      avgReplies,
      avgQuotes
    };
  };

  const engagement = calculateEngagement(tweets);

  // Add this function to analyze sentiment
  const analyzeSentiment = async (tweets: Tweet[]) => {
    if (!tweets.length) return;
    
    try {
      // Check backend health first
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        throw new Error("Backend server is not responding");
      }
      
      const response = await fetch('http://localhost:8000/analyze/sentiment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-token'
        },
        body: JSON.stringify({
          tweets: tweets.slice(0, 5).map(tweet => tweet.text)
        })
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      setSentimentAnalysis(data);
    } catch (err) {
      console.error('Error analyzing sentiment:', err);
      setError(err instanceof Error ? err.message : "Failed to analyze sentiment");
    }
  };

  // Add this function to check backend health
  const checkBackendHealth = async () => {
    try {
      const response = await fetch('http://localhost:8000/health');
      if (response.ok) {
        const data = await response.json();
        console.log("Backend health:", data);
        return data.status === "ok";
      }
      return false;
    } catch (err) {
      console.error("Backend health check failed:", err);
      return false;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Twitter Dashboard</h1>
            <div className="flex items-center gap-4">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="px-3 py-2 border rounded-md"
                placeholder="Enter username"
              />
              <button
                onClick={lookupUser}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
              >
                {loading ? "Loading..." : "Lookup"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-8 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            Error: {error}
          </div>
        )}

        {user && (
          <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4">
                <div className="bg-blue-100 dark:bg-blue-800 rounded-full w-16 h-16 flex items-center justify-center">
                  {user.profile_image_url ? (
                    <Image
                      src={user.profile_image_url}
                      alt={user.name}
                      width={64}
                      height={64}
                      className="rounded-full"
                    />
                  ) : (
                    <span className="text-2xl font-bold">{user.name.charAt(0)}</span>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{user.name}</h2>
                  <p className="text-gray-500 dark:text-gray-400">@{user.username}</p>
                  {user.description && (
                    <p className="mt-2 text-gray-700 dark:text-gray-300">{user.description}</p>
                  )}
                  {user.public_metrics && (
                    <div className="mt-2 flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                      <span>{user.public_metrics.followers_count.toLocaleString()} Followers</span>
                      <span>{user.public_metrics.following_count.toLocaleString()} Following</span>
                      <span>{user.public_metrics.tweet_count.toLocaleString()} Tweets</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
              <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
                <h2 className="text-xl font-semibold">
                  {showAllTweets ? "Latest 100 Tweets" : "Latest 5 Tweets"}
                </h2>
                <button
                  onClick={toggleTweetView}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {showAllTweets ? "Show Less" : "Show More"}
                </button>
              </div>
              
              {loading ? (
                <div className="p-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
                  <p className="mt-2 text-gray-500">Loading tweets...</p>
                </div>
              ) : tweets.length > 0 ? (
                <div>
                  <ul className="divide-y dark:divide-gray-700">
                    {tweets.map(tweet => (
                      <li key={tweet.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="font-semibold">@{user?.username}</span>
                              <span className="text-sm text-gray-500">{formatDate(tweet.created_at)}</span>
                            </div>
                            <p className="mt-1">{tweet.text}</p>
                            {tweet.public_metrics && (
                              <div className="mt-2 flex gap-4 text-sm text-gray-500">
                                <span>{tweet.public_metrics.like_count} Likes</span>
                                <span>{tweet.public_metrics.retweet_count} Retweets</span>
                                <span>{tweet.public_metrics.reply_count} Replies</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  
                  {nextToken && (
                    <div className="p-4 border-t dark:border-gray-700">
                      <button
                        onClick={loadMoreTweets}
                        disabled={loadingMore}
                        className="w-full py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-center"
                      >
                        {loadingMore ? "Loading more..." : "Load More Tweets"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  No tweets found.
                </div>
              )}
            </div>
          </div>
          
          <div className="space-y-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
              <div className="p-4 border-b dark:border-gray-700">
                <h2 className="text-xl font-semibold">Sentiment Analysis</h2>
              </div>
              <div className="p-6">
                {loading ? (
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
                    <p className="mt-2 text-gray-500">Analyzing sentiment...</p>
                  </div>
                ) : sentimentAnalysis ? (
                  <div className="text-center">
                    <div className="text-4xl font-bold mb-2 capitalize">{sentimentAnalysis.overall.sentiment}</div>
                    <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
                      <div
                        className={`h-4 rounded-full ${
                          sentimentAnalysis.overall.sentiment === 'positive' ? 'bg-green-500' : 
                          sentimentAnalysis.overall.sentiment === 'negative' ? 'bg-red-500' : 'bg-gray-400'
                        }`}
                        style={{ 
                          width: `${sentimentAnalysis.overall.scores[sentimentAnalysis.overall.sentiment] * 100}%` 
                        }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
                        <div className="text-lg font-semibold">
                          {Math.round(sentimentAnalysis.overall.scores.negative * 100)}%
                        </div>
                        <div className="text-sm text-gray-500">Negative</div>
                      </div>
                      <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded">
                        <div className="text-lg font-semibold">
                          {Math.round(sentimentAnalysis.overall.scores.neutral * 100)}%
                        </div>
                        <div className="text-sm text-gray-500">Neutral</div>
                      </div>
                      <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
                        <div className="text-lg font-semibold">
                          {Math.round(sentimentAnalysis.overall.scores.positive * 100)}%
                        </div>
                        <div className="text-sm text-gray-500">Positive</div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500">
                      Based on analysis of the 5 most recent tweets
                    </p>
                  </div>
                ) : tweets.length > 0 ? (
                  <div className="text-center text-gray-500">
                    <p>Click to analyze sentiment</p>
                    <button
                      onClick={() => analyzeSentiment(tweets.slice(0, 5))}
                      className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Analyze Sentiment
                    </button>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">
                    No data available
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
              <div className="p-4 border-b dark:border-gray-700">
                <h2 className="text-xl font-semibold">Engagement Metrics</h2>
              </div>
              <div className="p-6">
                {engagement ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium mb-2">Average per Tweet</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                          <div className="text-2xl font-bold">{engagement.avgLikes.toFixed(1)}</div>
                          <div className="text-sm text-gray-500">Likes</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
                          <div className="text-2xl font-bold">{engagement.avgRetweets.toFixed(1)}</div>
                          <div className="text-sm text-gray-500">Retweets</div>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg">
                          <div className="text-2xl font-bold">{engagement.avgReplies.toFixed(1)}</div>
                          <div className="text-sm text-gray-500">Replies</div>
                        </div>
                        <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg">
                          <div className="text-2xl font-bold">{engagement.avgQuotes.toFixed(1)}</div>
                          <div className="text-sm text-gray-500">Quotes</div>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-medium mb-2">Total Engagement</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 border rounded-lg">
                          <div className="text-2xl font-bold">{engagement.totalLikes.toLocaleString()}</div>
                          <div className="text-sm text-gray-500">Total Likes</div>
                        </div>
                        <div className="p-3 border rounded-lg">
                          <div className="text-2xl font-bold">{engagement.totalRetweets.toLocaleString()}</div>
                          <div className="text-sm text-gray-500">Total Retweets</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">
                    No engagement data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
