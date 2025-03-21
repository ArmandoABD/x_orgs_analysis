"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Chart, registerables } from 'chart.js';
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
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

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
      
      if (data.data && data.data.length > 0) {
        if (paginationToken) {
          const newTweets = [...tweets, ...data.data];
          setTweets(newTweets);
          
          // Fetch historical metrics for the first 5 tweets
          const tweetIds = newTweets.slice(0, 5).map(t => t.id);
          console.log("Fetching historical metrics for tweet IDs:", tweetIds);
          await fetchHistoricalMetrics(userId, tweetIds);
        } else {
          setTweets(data.data);
          
          // Fetch historical metrics for the first 5 tweets
          const tweetIds = data.data.slice(0, 5).map(t => t.id);
          console.log("Fetching historical metrics for tweet IDs:", tweetIds);
          await fetchHistoricalMetrics(userId, tweetIds);
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
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Calculate engagement metrics
  const engagement = tweets.length > 0 ? {
    totalLikes: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.like_count || 0), 0),
    totalRetweets: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.retweet_count || 0), 0),
    totalReplies: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.reply_count || 0), 0),
    totalQuotes: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.quote_count || 0), 0),
    avgLikes: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.like_count || 0), 0) / tweets.length,
    avgRetweets: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.retweet_count || 0), 0) / tweets.length,
    avgReplies: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.reply_count || 0), 0) / tweets.length,
    avgQuotes: tweets.reduce((sum, tweet) => sum + (tweet.public_metrics?.quote_count || 0), 0) / tweets.length,
  } : null;

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

  // Add this function to fetch historical metrics
  const fetchHistoricalMetrics = async (userId: string, tweetIds: string[]) => {
    if (!tweetIds.length) return;
    
    try {
      // Calculate date range (last 7 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      
      // Format dates as ISO strings
      const startTime = startDate.toISOString().split('.')[0] + 'Z';
      const endTime = endDate.toISOString().split('.')[0] + 'Z';
      
      // Build query parameters
      const params = new URLSearchParams();
      tweetIds.forEach(id => params.append('tweet_ids', id));
      params.append('start_time', startTime);
      params.append('end_time', endTime);
      params.append('granularity', 'day');
      ['impression_count', 'like_count', 'retweet_count', 'reply_count'].forEach(
        metric => params.append('requested_metrics', metric)
      );
      
      console.log("Fetching historical metrics with params:", params.toString());
      
      // Fetch historical metrics
      const response = await fetch(`http://localhost:8000/users/${userId}/historical?${params.toString()}`, {
        headers: {
          "Authorization": "Bearer dummy-token"
        }
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Historical metrics data:", data);
      setHistoricalMetrics(data);
      
    } catch (err) {
      console.error('Error fetching historical metrics:', err);
    }
  };

  // Add this useEffect to create the chart when historical metrics data is received
  useEffect(() => {
    if (historicalMetrics && chartRef.current) {
      createEngagementChart(historicalMetrics);
    }
  }, [historicalMetrics]);

  // Update the createEngagementChart function with better error handling
  const createEngagementChart = (data: any) => {
    if (!chartRef.current) return;
    
    // Destroy existing chart if it exists
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }
    
    // Validate data structure
    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      console.error("Invalid historical metrics data structure:", data);
      return;
    }
    
    // Extract data for the chart - with safer access
    const measurement = data.data[0]?.measurement;
    if (!measurement || !measurement.metrics_time_series) {
      console.error("Missing metrics_time_series in data:", data);
      return;
    }
    
    const timeSeriesData = measurement.metrics_time_series || [];
    
    // Group by timestamp
    const groupedByTime: Record<string, Record<string, number>> = {};
    
    timeSeriesData.forEach((series: any) => {
      if (!series.value || !series.value.timestamp || !series.value.metric_values) {
        return; // Skip invalid entries
      }
      
      const timestamp = series.value.timestamp.iso8601_time;
      if (!timestamp) return;
      
      const date = new Date(timestamp).toLocaleDateString();
      
      if (!groupedByTime[date]) {
        groupedByTime[date] = {};
      }
      
      series.value.metric_values.forEach((metric: any) => {
        if (!metric.metric_type) return;
        
        const metricType = metric.metric_type;
        if (!groupedByTime[date][metricType]) {
          groupedByTime[date][metricType] = 0;
        }
        groupedByTime[date][metricType] += metric.metric_value || 0;
      });
    });
    
    // Check if we have any data to display
    const labels = Object.keys(groupedByTime).sort((a, b) => 
      new Date(a).getTime() - new Date(b).getTime()
    );
    
    if (labels.length === 0) {
      console.error("No valid data points found for chart");
      return;
    }
    
    // Prepare data for Chart.js
    const datasets = [
      {
        label: 'Likes',
        data: labels.map(date => groupedByTime[date]['like_count'] || 0),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        tension: 0.1
      },
      {
        label: 'Retweets',
        data: labels.map(date => groupedByTime[date]['retweet_count'] || 0),
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.5)',
        tension: 0.1
      },
      {
        label: 'Replies',
        data: labels.map(date => groupedByTime[date]['reply_count'] || 0),
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.5)',
        tension: 0.1
      }
    ];
    
    // Create the chart
    const ctx = chartRef.current.getContext('2d');
    if (ctx) {
      try {
        chartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  color: 'rgb(209, 213, 219)'
                }
              },
              title: {
                display: true,
                text: 'Engagement Over Time (Last 7 Days)',
                color: 'rgb(209, 213, 219)'
              }
            },
            scales: {
              x: {
                ticks: {
                  color: 'rgb(156, 163, 175)'
                },
                grid: {
                  color: 'rgba(75, 85, 99, 0.2)'
                }
              },
              y: {
                ticks: {
                  color: 'rgb(156, 163, 175)'
                },
                grid: {
                  color: 'rgba(75, 85, 99, 0.2)'
                },
                beginAtZero: true
              }
            }
          }
        });
      } catch (err) {
        console.error("Error creating chart:", err);
      }
    }
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                <h2 className="text-xl font-semibold">
                  {showAllTweets ? "Latest 100 Tweets" : "Latest 5 Tweets"}
                </h2>
                <button
                  onClick={toggleTweetView}
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {showAllTweets ? "Show Less" : "Show More"}
                </button>
              </div>
              
              {loading ? (
                <div className="p-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-700 border-t-blue-500"></div>
                  <p className="mt-2 text-gray-400">Loading tweets...</p>
                </div>
              ) : tweets.length > 0 ? (
                <div>
                  <ul className="divide-y divide-gray-800">
                    {tweets.map(tweet => (
                      <li key={tweet.id} className="p-4 hover:bg-gray-800/50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="font-semibold">@{user?.username}</span>
                              <span className="text-sm text-gray-400">{formatDate(tweet.created_at)}</span>
                            </div>
                            <p className="mt-1 text-gray-200">{tweet.text}</p>
                            {tweet.public_metrics && (
                              <div className="mt-2 flex gap-4 text-sm text-gray-400">
                                <span className="flex items-center">
                                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                  </svg>
                                  {tweet.public_metrics.like_count}
                                </span>
                                <span className="flex items-center">
                                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                  </svg>
                                  {tweet.public_metrics.retweet_count}
                                </span>
                                <span className="flex items-center">
                                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                  </svg>
                                  {tweet.public_metrics.reply_count}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  
                  {nextToken && (
                    <div className="p-4 border-t border-gray-800">
                      <button
                        onClick={loadMoreTweets}
                        disabled={loadingMore}
                        className="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded text-center transition-colors"
                      >
                        {loadingMore ? "Loading more..." : "Load More Tweets"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-400">
                  No tweets found.
                </div>
              )}
            </div>
          </div>
          
          <div className="space-y-8">
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
                      Based on analysis of the 5 most recent tweets
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
            
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-800">
                <h2 className="text-xl font-semibold">Engagement Metrics</h2>
              </div>
              <div className="p-6">
                {engagement ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium mb-2 text-gray-300">Average per Tweet</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-blue-900/20 border border-blue-800/50 p-3 rounded-lg">
                          <div className="text-2xl font-bold text-blue-400">{engagement.avgLikes.toFixed(1)}</div>
                          <div className="text-sm text-gray-400">Likes</div>
                        </div>
                        <div className="bg-green-900/20 border border-green-800/50 p-3 rounded-lg">
                          <div className="text-2xl font-bold text-green-400">{engagement.avgRetweets.toFixed(1)}</div>
                          <div className="text-sm text-gray-400">Retweets</div>
                        </div>
                        <div className="bg-purple-900/20 border border-purple-800/50 p-3 rounded-lg">
                          <div className="text-2xl font-bold text-purple-400">{engagement.avgReplies.toFixed(1)}</div>
                          <div className="text-sm text-gray-400">Replies</div>
                        </div>
                        <div className="bg-orange-900/20 border border-orange-800/50 p-3 rounded-lg">
                          <div className="text-2xl font-bold text-orange-400">{engagement.avgQuotes.toFixed(1)}</div>
                          <div className="text-sm text-gray-400">Quotes</div>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-medium mb-2 text-gray-300">Total Engagement</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 border border-gray-700 rounded-lg">
                          <div className="text-2xl font-bold text-gray-200">{engagement.totalLikes.toLocaleString()}</div>
                          <div className="text-sm text-gray-400">Total Likes</div>
                        </div>
                        <div className="p-3 border border-gray-700 rounded-lg">
                          <div className="text-2xl font-bold text-gray-200">{engagement.totalRetweets.toLocaleString()}</div>
                          <div className="text-sm text-gray-400">Total Retweets</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    No engagement data available
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-800">
              <h3 className="text-lg font-medium mb-4 text-gray-300">Historical Engagement (Last 7 Days)</h3>
              
              {historicalMetrics ? (
                <div className="h-64">
                  <canvas ref={chartRef}></canvas>
                </div>
              ) : (
                <div className="text-center text-gray-400 py-8">
                  {loading ? (
                    <div>
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-700 border-t-blue-500"></div>
                      <p className="mt-2">Loading historical data...</p>
                    </div>
                  ) : (
                    <p>No historical data available</p>
                  )}
                </div>
              )}
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
