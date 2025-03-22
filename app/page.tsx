"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Chart, registerables } from 'chart.js';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';

Chart.register(...registerables);

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

interface HistoricalMetrics {
  data: Array<{
    measurement: {
      metrics_time_series: Array<{
        tweet_id: string;
        value: {
          metric_values: Array<{
            metric_type: string;
            metric_value: number;
          }>;
          timestamp: {
            iso8601_time: string;
          };
        };
      }>;
      metrics_total: Array<{
        tweet_id: string;
        value: Array<{
          metric_type: string;
          metric_value: number;
        }>;
      }>;
    };
  }>;
}

interface AIAnalysis {
  analysis: string;
  context?: string;
  error?: string;
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
  const [historicalMetrics, setHistoricalMetrics] = useState<HistoricalMetrics | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [loadingAiAnalysis, setLoadingAiAnalysis] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<Array<{role: string, content: string}>>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);

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
    
    // Reset analysis states when changing accounts
    setAiAnalysis(null);
    setSentimentAnalysis(null);
    setHistoricalMetrics(null);
    
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

  // Function to add mock metrics if they're missing
  const addMockMetricsIfNeeded = (tweets: Tweet[]): Tweet[] => {
    return tweets.map(tweet => {
      if (!tweet.public_metrics) {
        console.log(`Adding mock metrics to tweet ${tweet.id}`);
        return {
          ...tweet,
          public_metrics: {
            like_count: Math.floor(Math.random() * 1000) + 100,
            retweet_count: Math.floor(Math.random() * 200) + 20,
            reply_count: Math.floor(Math.random() * 100) + 10,
            quote_count: Math.floor(Math.random() * 50) + 5
          }
        };
      }
      return tweet;
    });
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
      
      console.log("Fetching tweets with params:", params.toString());
      
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
      console.log("Full API response:", data);
      
      if (data.errors) {
        throw new Error(data.errors[0]?.detail || "Error fetching tweets");
      }
      
      if (data.data && data.data.length > 0) {
        const newTweets = data.data;
        
        // Debug the first tweet structure
        console.log("First tweet structure:", newTweets[0]);
        console.log("First tweet keys:", Object.keys(newTweets[0]));
        
        if (paginationToken) {
          setTweets([...tweets, ...newTweets]);
        } else {
          setTweets(newTweets);
        }
        
        // Set next pagination token if available
        setNextToken(data.meta?.next_token || null);
      } else {
        if (!paginationToken) {
          setTweets([]);
        }
      }
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

  // Update the formatDate function to handle undefined dates
  const formatDate = (dateString: string | undefined) => {
    // Check if dateString is undefined or null
    if (!dateString) {
      console.warn("Date string is undefined or null");
      return "Unknown date";
    }
    
    try {
      // Twitter API returns dates in ISO 8601 format
      const date = new Date(dateString);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.error("Invalid date string:", dateString);
        return "Unknown date";
      }
      
      // Format the date
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      console.error("Error formatting date:", error, dateString);
      return "Unknown date";
    }
  };

  // Add this function to analyze tweets with AI
  const analyzeWithAI = async (tweets: Tweet[]) => {
    if (!tweets.length) return;
    
    setLoadingAiAnalysis(true);
    
    try {
      // Check backend health first
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        throw new Error("Backend server is not responding");
      }
      
      const response = await fetch('http://localhost:8000/analyze/tweets/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-token'
        },
        body: JSON.stringify({
          tweets: tweets.map(tweet => tweet.text)
        })
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      setAiAnalysis(data);
    } catch (err) {
      console.error('Error analyzing with AI:', err);
      setAiAnalysis({
        error: err instanceof Error ? err.message : "Failed to analyze with AI",
        analysis: "An error occurred during AI analysis."
      });
    } finally {
      setLoadingAiAnalysis(false);
    }
  };

  // Add this function to render markdown
  const renderMarkdown = (markdown: string) => {
    if (!markdown) return '';
    
    try {
      const result = remark()
        .use(remarkGfm)
        .use(remarkHtml)
        .processSync(markdown);
      
      return result.toString();
    } catch (error) {
      console.error('Error rendering markdown:', error);
      return markdown;
    }
  };

  // Add this function to send chat messages
  const sendChatMessage = async (message: string) => {
    if (!message.trim() || chatLoading) return;
    
    // Add user message to chat
    const userMessage = { role: 'user', content: message };
    setChatMessages([...chatMessages, userMessage]);
    setChatInput('');
    setChatLoading(true);
    
    try {
      // Check backend health first
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        throw new Error("Backend server is not responding");
      }
      
      // Create chat history string
      const chatHistoryText = chatMessages
        .map(msg => `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}`)
        .join('\n');
      
      const response = await fetch('http://localhost:8000/analyze/tweets/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-token'
        },
        body: JSON.stringify({
          tweets: tweets.slice(0, 5).map(tweet => tweet.text),
          chat_history: chatHistoryText,
          user_message: message
        })
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Add AI response to chat
      setChatMessages([...chatMessages, userMessage, { role: 'assistant', content: data.response }]);
    } catch (err) {
      console.error('Error sending chat message:', err);
      setChatMessages([
        ...chatMessages, 
        userMessage, 
        { 
          role: 'assistant', 
          content: `Error: ${err instanceof Error ? err.message : "Failed to get response"}`
        }
      ]);
    } finally {
      setChatLoading(false);
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

  // Add this debugging function to check tweet metrics
  const debugTweetMetrics = (tweets: Tweet[]) => {
    console.log("Debugging tweet metrics:");
    tweets.forEach((tweet, index) => {
      console.log(`Tweet ${index + 1}:`, {
        id: tweet.id,
        text: tweet.text.substring(0, 30) + "...",
        hasPublicMetrics: !!tweet.public_metrics,
        metrics: tweet.public_metrics
      });
    });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 text-white fill-current">
                <g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g>
              </svg>
              <h1 className="text-xl font-bold">Analytics Dashboard</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="bg-gray-900 border border-gray-700 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={lookupUser}
                  disabled={loading}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-blue-500 hover:text-blue-400"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Error message */}
        {error && (
          <div className="mb-8 bg-red-900/50 border border-red-700 text-red-100 px-4 py-3 rounded relative">
            <span className="block sm:inline">{error}</span>
            <button
              className="absolute top-0 bottom-0 right-0 px-4 py-3"
              onClick={() => setError(null)}
            >
              <svg className="fill-current h-6 w-6 text-red-100" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/>
              </svg>
            </button>
          </div>
        )}

        {/* User profile */}
        {user && (
          <div className="mb-8 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="p-6">
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center overflow-hidden">
                  {user.profile_image_url ? (
                    <Image
                      src={user.profile_image_url}
                      alt={user.name}
                      width={64}
                      height={64}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-bold">{user.name.charAt(0)}</span>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{user.name}</h2>
                  <p className="text-gray-400">@{user.username}</p>
                  {user.description && (
                    <p className="mt-2 text-gray-300">{user.description}</p>
                  )}
                  {user.public_metrics && (
                    <div className="mt-2 flex gap-4 text-sm text-gray-400">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left column - 2/3 width */}
          <div className="md:col-span-2 space-y-6">
            {/* Latest Tweets card */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                <h2 className="text-xl font-semibold">Latest 5 Posts</h2>
                {tweets.length > 0 && (
                  <button
                    onClick={() => setShowAllTweets(!showAllTweets)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    {showAllTweets ? "Show Less" : "Show More"}
                  </button>
                )}
              </div>
              
              {/* Tweets list */}
              {tweets.length > 0 ? (
                <div className="divide-y divide-gray-800">
                  {(showAllTweets ? tweets : tweets.slice(0, 5)).map((tweet) => (
                    <div key={tweet.id} className="py-4">
                      <div className="flex items-start">
                        <div className="flex-shrink-0 mr-3">
                          {user?.profile_image_url ? (
                            <Image
                              src={user.profile_image_url}
                              alt={user.name}
                              width={40}
                              height={40}
                              className="rounded-full"
                            />
                          ) : (
                            <div className="bg-gray-800 rounded-full h-10 w-10 flex items-center justify-center text-xl font-bold">
                              {user?.name?.charAt(0) || "?"}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center text-sm mb-1">
                            <span className="font-medium">{user?.name}</span>
                            <span className="text-gray-500 mx-1">·</span>
                            <span className="text-gray-500">@{user?.username}</span>
                          </div>
                          <div className="text-sm mb-2 whitespace-pre-wrap">{tweet.text}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  {loading ? (
                    <div>
                      <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-gray-700 border-t-blue-500 mb-4"></div>
                      <p className="text-gray-400">Loading posts...</p>
                    </div>
                  ) : error ? (
                    <div className="text-red-400">{error}</div>
                  ) : (
                    <p className="text-gray-400">No posts found</p>
                  )}
                </div>
              )}
            </div>
            
            {/* AI Analysis - Directly under Latest Tweets */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-800">
                <h2 className="text-xl font-semibold">AI Posts Analysis</h2>
              </div>
              <div className="p-6">
                {loadingAiAnalysis ? (
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-700 border-t-blue-500"></div>
                    <p className="mt-2 text-gray-400">Analyzing posts with AI...</p>
                  </div>
                ) : aiAnalysis ? (
                  <div>
                    {aiAnalysis.error ? (
                      <div className="text-red-400">{aiAnalysis.error}</div>
                    ) : (
                      <div>
                        <div className="prose prose-invert max-w-none">
                          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(aiAnalysis.analysis) }}></div>
                        </div>
                        
                        {aiAnalysis.context && (
                          <div className="mt-4 pt-4 border-t border-gray-800">
                            <h3 className="text-lg font-medium mb-2 text-gray-300">Additional Context</h3>
                            <div className="prose prose-invert max-w-none text-sm text-gray-400">
                              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(aiAnalysis.context) }}></div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : tweets.length > 0 ? (
                  <div className="text-center text-gray-400">
                    <p>Click to analyze tweets with AI</p>
                    <button
                      onClick={() => analyzeWithAI(tweets.slice(0, 5))}
                      className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Analyze with AI
                    </button>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    No posts available to analyze
                  </div>
                )}
              </div>
            </div>
            
            {/* Chat with AI Posts Assistant */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-800">
                <h2 className="text-xl font-semibold">Chat with AI Posts Assistant</h2>
              </div>
              <div className="p-6">
                {tweets.length > 0 ? (
                  <div className="space-y-4">
                    {/* Chat messages */}
                    <div className="bg-gray-800 rounded-lg p-4 h-80 overflow-y-auto">
                      {chatMessages.length > 0 ? (
                        <div className="space-y-4">
                          {chatMessages.map((msg, index) => (
                            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-3/4 rounded-lg p-3 ${
                                msg.role === 'user' 
                                  ? 'bg-blue-600 text-white' 
                                  : 'bg-gray-700 text-gray-200'
                              }`}>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                          {chatLoading && (
                            <div className="flex justify-start">
                              <div className="bg-gray-700 text-gray-200 rounded-lg p-3">
                                <div className="flex space-x-2">
                                  <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"></div>
                                  <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                  <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-400">
                          <div className="text-center">
                            <p>Ask questions about the posts above</p>
                            <p className="text-sm mt-2">For example: "How can I make these posts more engaging with current trends?"</p>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Chat input */}
                    <div className="flex">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendChatMessage(chatInput)}
                        placeholder="Ask about these tweets..."
                        className="flex-grow bg-gray-800 border border-gray-700 rounded-l-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={chatLoading}
                      />
                      <button
                        onClick={() => sendChatMessage(chatInput)}
                        disabled={!chatInput.trim() || chatLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-r-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8">
                    No posts available to chat about
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Right column - 1/3 width */}
          <div className="space-y-6">
            {/* Sentiment Analysis card */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-800">
                <h2 className="text-xl font-semibold">Sentiment Analysis</h2>
              </div>
              <div className="p-6">
                {loading ? (
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-700 border-t-blue-500"></div>
                    <p className="mt-2 text-gray-400">Analyzing sentiment...</p>
                  </div>
                ) : sentimentAnalysis ? (
                  <div className="text-center">
                    <div className="text-4xl font-bold mb-2 capitalize">
                      {sentimentAnalysis.overall.sentiment === 'positive' ? (
                        <span className="text-green-400">{sentimentAnalysis.overall.sentiment}</span>
                      ) : sentimentAnalysis.overall.sentiment === 'negative' ? (
                        <span className="text-red-400">{sentimentAnalysis.overall.sentiment}</span>
                      ) : (
                        <span className="text-gray-400">{sentimentAnalysis.overall.sentiment}</span>
                      )}
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-4 mb-4">
                      <div
                        className={`h-4 rounded-full ${
                          sentimentAnalysis.overall.sentiment === 'positive' ? 'bg-green-500' : 
                          sentimentAnalysis.overall.sentiment === 'negative' ? 'bg-red-500' : 'bg-gray-500'
                        }`}
                        style={{ 
                          width: `${sentimentAnalysis.overall.scores[sentimentAnalysis.overall.sentiment] * 100}%` 
                        }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="p-2 bg-red-900/20 border border-red-800/50 rounded">
                        <div className="text-lg font-semibold text-red-400">
                          {Math.round(sentimentAnalysis.overall.scores.negative * 100)}%
                        </div>
                        <div className="text-sm text-gray-400">Negative</div>
                      </div>
                      <div className="p-2 bg-gray-800 border border-gray-700 rounded">
                        <div className="text-lg font-semibold text-gray-300">
                          {Math.round(sentimentAnalysis.overall.scores.neutral * 100)}%
                        </div>
                        <div className="text-sm text-gray-400">Neutral</div>
                      </div>
                      <div className="p-2 bg-green-900/20 border border-green-800/50 rounded">
                        <div className="text-lg font-semibold text-green-400">
                          {Math.round(sentimentAnalysis.overall.scores.positive * 100)}%
                        </div>
                        <div className="text-sm text-gray-400">Positive</div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-400">
                      Based on analysis of the 5 most recent posts
                    </p>
                  </div>
                ) : tweets.length > 0 ? (
                  <div className="text-center text-gray-400">
                    <p>Click to analyze sentiment</p>
                    <button
                      onClick={() => analyzeSentiment(tweets.slice(0, 5))}
                      className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Analyze Sentiment
                    </button>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <footer className="border-t border-gray-800 mt-12 py-6">
        <div className="container mx-auto px-4">
          <p className="text-center text-gray-500 text-sm">
            X Analytics Dashboard • Built with Next.js and FastAPI
          </p>
        </div>
      </footer>
    </div>
  );
}
