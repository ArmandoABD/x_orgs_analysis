from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List, Optional, Dict, Any
import requests
from pydantic import BaseModel
import os
import time
from dotenv import load_dotenv
import threading
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer
import fireworks.client
import datetime
import random
from openai import OpenAI

# Load environment variables from .env file
load_dotenv()

# Initialize NLTK components
MODEL_LOADED = False

def load_model():
    global sia, MODEL_LOADED
    try:
        print("Loading sentiment analysis model...")
        nltk.download('vader_lexicon', quiet=True)
        sia = SentimentIntensityAnalyzer()
        MODEL_LOADED = True
        print("Sentiment analysis model loaded successfully!")
    except Exception as e:
        print(f"Error loading model: {e}")

# Start model loading in a separate thread
threading.Thread(target=load_model).start()

app = FastAPI(title="X API Proxy")

# CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security scheme for Bearer token
security = HTTPBearer()

# Twitter API base URL and credentials from environment variables
TWITTER_API_BASE = "https://api.twitter.com/2"
DEFAULT_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN", "")
API_KEY = os.getenv("TWITTER_API_KEY", "")
API_SECRET = os.getenv("TWITTER_API_SECRET", "")
ACCESS_TOKEN = os.getenv("TWITTER_ACCESS_TOKEN", "")
ACCESS_TOKEN_SECRET = os.getenv("TWITTER_ACCESS_TOKEN_SECRET", "")

# Set up Fireworks AI client
FIREWORKS_API_KEY = os.getenv("FIREWORKS_API_KEY", "")
if FIREWORKS_API_KEY:
    fireworks.client.api_key = FIREWORKS_API_KEY
else:
    print("WARNING: FIREWORKS_API_KEY environment variable is not set!")

# Print a warning if the bearer token is missing
if not DEFAULT_BEARER_TOKEN:
    print("WARNING: TWITTER_BEARER_TOKEN environment variable is not set!")

# Models
class PostsResponse(BaseModel):
    data: Optional[List[Dict[str, Any]]] = None
    meta: Optional[Dict[str, Any]] = None
    includes: Optional[Dict[str, Any]] = None
    errors: Optional[List[Dict[str, Any]]] = None

class UserResponse(BaseModel):
    data: Optional[Dict[str, Any]] = None
    includes: Optional[Dict[str, Any]] = None
    errors: Optional[List[Dict[str, Any]]] = None

# Authentication middleware
def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    # If a token is provided in the request, use it
    if credentials and credentials.credentials and credentials.credentials != "dummy-token":
        return credentials.credentials
    # Otherwise use the default token
    return DEFAULT_BEARER_TOKEN

# Add this function to handle rate limits
def make_twitter_request(url, headers, params, max_retries=3):
    """Make a request to Twitter API with retry logic for rate limits"""
    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, params=params)
            
            # If we get a rate limit error, wait and retry
            if response.status_code == 429:
                retry_after = int(response.headers.get('retry-after', 60))
                print(f"Rate limited. Waiting {retry_after} seconds before retrying...")
                time.sleep(retry_after)
                continue
                
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 429 and attempt < max_retries - 1:
                    retry_after = int(e.response.headers.get('retry-after', 60))
                    print(f"Rate limited. Waiting {retry_after} seconds before retrying...")
                    time.sleep(retry_after)
                    continue
                return e.response.json()
            raise
    
    # If we've exhausted retries
    return {"errors": [{"detail": "Maximum retries exceeded due to rate limits"}]}

@app.get("/users/by/username/{username}", response_model=UserResponse)
async def get_user_by_username(
    username: str,
    token: str = Depends(verify_token),
    user_fields: Optional[List[str]] = Query(None),
    expansions: Optional[List[str]] = Query(None),
    tweet_fields: Optional[List[str]] = Query(None),
):
    """
    Lookup a Twitter user by username using the real Twitter API
    """
    print(f"Looking up user: {username}")
    
    # Build query parameters
    params = {}
    if user_fields:
        params["user.fields"] = ",".join(user_fields)
    if expansions:
        params["expansions"] = ",".join(expansions)
    if tweet_fields:
        params["tweet.fields"] = ",".join(tweet_fields)
    
    # Make request to Twitter API
    url = f"{TWITTER_API_BASE}/users/by/username/{username}"
    headers = {"Authorization": f"Bearer {token}"}
    
    result = make_twitter_request(url, headers, params)
    print(f"User lookup result: {result}")
    return result

@app.get("/users/{id}/tweets", response_model=PostsResponse)
async def get_user_posts(
    id: str,
    token: str = Depends(verify_token),
    since_id: Optional[str] = None,
    until_id: Optional[str] = None,
    max_results: Optional[int] = 10,
    pagination_token: Optional[str] = None,
    exclude: Optional[List[str]] = Query(None),
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    tweet_fields: Optional[List[str]] = Query(None),
    expansions: Optional[List[str]] = Query(None),
    media_fields: Optional[List[str]] = Query(None),
    poll_fields: Optional[List[str]] = Query(None),
    user_fields: Optional[List[str]] = Query(None),
    place_fields: Optional[List[str]] = Query(None),
):
    """
    Get tweets for a user using the Twitter API
    """
    print(f"Fetching tweets for user ID: {id}")
    print(f"Parameters: max_results={max_results}, exclude={exclude}")
    
    # Build query parameters
    params = {}
    if since_id:
        params["since_id"] = since_id
    if until_id:
        params["until_id"] = until_id
    if max_results:
        params["max_results"] = max_results
    if pagination_token:
        params["pagination_token"] = pagination_token
    if exclude:
        params["exclude"] = ",".join(exclude)
    if start_time:
        params["start_time"] = start_time
    if end_time:
        params["end_time"] = end_time
    if tweet_fields:
        params["tweet.fields"] = ",".join(tweet_fields)
        print(f"Requesting tweet fields: {params['tweet.fields']}")
    if expansions:
        params["expansions"] = ",".join(expansions)
    if media_fields:
        params["media.fields"] = ",".join(media_fields)
    if poll_fields:
        params["poll.fields"] = ",".join(poll_fields)
    if user_fields:
        params["user.fields"] = ",".join(user_fields)
    if place_fields:
        params["place.fields"] = ",".join(place_fields)
    
    # Make request to Twitter API
    url = f"{TWITTER_API_BASE}/users/{id}/tweets"
    headers = {"Authorization": f"Bearer {token}"}
    
    print(f"Making request to: {url}")
    print(f"With params: {params}")
    
    result = make_twitter_request(url, headers, params)
    
    # Debug the full response structure
    print(f"Response structure: {list(result.keys())}")
    
    # Check if public_metrics are included in the response
    if 'data' in result and len(result['data']) > 0:
        first_tweet = result['data'][0]
        print(f"First tweet keys: {list(first_tweet.keys())}")
        has_metrics = 'public_metrics' in first_tweet
        print(f"Retrieved {len(result['data'])} tweets. Public metrics included: {has_metrics}")
        if not has_metrics:
            print("WARNING: public_metrics not included in tweet data. Make sure tweet.fields includes 'public_metrics'")
    
    return result

# Function to analyze sentiment of a tweet using NLTK VADER
def analyze_sentiment(text):
    if not MODEL_LOADED:
        return {
            "scores": {"negative": 0.0, "neutral": 1.0, "positive": 0.0},
            "sentiment": "neutral",
            "confidence": 1.0
        }
    
    # Get sentiment scores
    scores = sia.polarity_scores(text)
    
    # Determine sentiment
    if scores['compound'] >= 0.05:
        sentiment = "positive"
    elif scores['compound'] <= -0.05:
        sentiment = "negative"
    else:
        sentiment = "neutral"
    
    # Format the result
    result = {
        "scores": {
            "negative": scores['neg'],
            "neutral": scores['neu'],
            "positive": scores['pos']
        },
        "sentiment": sentiment,
        "confidence": abs(scores['compound'])
    }
    
    return result

# Add a new endpoint for sentiment analysis
class SentimentRequest(BaseModel):
    tweets: List[str]

class SentimentResponse(BaseModel):
    overall: Dict[str, Any]
    individual: List[Dict[str, Any]]

@app.post("/analyze/sentiment", response_model=SentimentResponse)
async def analyze_tweets_sentiment(request: SentimentRequest):
    """
    Analyze the sentiment of a list of tweets
    """
    global MODEL_LOADED
    
    if not MODEL_LOADED:
        return {
            "overall": {"sentiment": "neutral", "scores": {"negative": 0, "neutral": 1, "positive": 0}},
            "individual": [{"text": "Model still loading...", "sentiment": "neutral", "scores": {"negative": 0, "neutral": 1, "positive": 0}}]
        }
    
    print(f"Analyzing sentiment for {len(request.tweets)} tweets")
    
    # Analyze each tweet individually
    individual_results = []
    for tweet in request.tweets:
        result = analyze_sentiment(tweet)
        individual_results.append({
            "text": tweet,
            "sentiment": result["sentiment"],
            "scores": result["scores"]
        })
    
    # Calculate overall sentiment
    if not individual_results:
        overall = {"sentiment": "neutral", "scores": {"negative": 0, "neutral": 1, "positive": 0}}
    else:
        # Average the scores across all tweets
        avg_scores = {
            "negative": sum(r["scores"]["negative"] for r in individual_results) / len(individual_results),
            "neutral": sum(r["scores"]["neutral"] for r in individual_results) / len(individual_results),
            "positive": sum(r["scores"]["positive"] for r in individual_results) / len(individual_results)
        }
        
        # Determine overall sentiment
        overall_sentiment = max(avg_scores, key=avg_scores.get)
        
        overall = {
            "sentiment": overall_sentiment,
            "scores": avg_scores
        }
    
    return {
        "overall": overall,
        "individual": individual_results
    }

@app.get("/health")
async def health_check():
    """
    Simple health check endpoint
    """
    return {"status": "ok", "model_loaded": MODEL_LOADED}

# Load environment variables
load_dotenv()
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")

# Update the Perplexity API call function to use OpenAI client and refer to "posts"
def get_perplexity_context(posts):
    """Get concise additional context about posts using Perplexity API"""
    if not PERPLEXITY_API_KEY:
        print("WARNING: PERPLEXITY_API_KEY not set")
        return None
    
    try:
        # Format posts for the prompt without numbering
        posts_text = "\n\n".join(posts)
        
        # Create the prompt requesting concise context
        prompt = f"Provide very concise insights about these posts (2-3 sentences max):\n\n{posts_text}"
        
        # Initialize the OpenAI client
        client = OpenAI(api_key=PERPLEXITY_API_KEY, base_url="https://api.perplexity.ai")
        
        # Call the Perplexity API with the OpenAI client
        response = client.chat.completions.create(
            model="sonar-pro",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that provides extremely concise context (2-3 sentences max) about social media posts."},
                {"role": "user", "content": prompt}
            ]
        )
        
        # Extract the context from the response
        if response and response.choices:
            context = response.choices[0].message.content
            return context
        
        return None
    
    except Exception as e:
        print(f"Error calling Perplexity API: {e}")
        return None

# Update the analyze_tweets_with_ai function to use "posts" terminology
@app.post("/analyze/tweets/ai", response_model=Dict[str, Any])
async def analyze_posts_with_ai(request: Dict[str, Any]):
    """
    Analyze social media posts using Fireworks AI LLaMA model with Perplexity context
    """
    if not FIREWORKS_API_KEY:
        return {
            "error": "Fireworks API key not configured",
            "analysis": "AI analysis is not available. Please configure a Fireworks API key."
        }
    
    posts = request.get("tweets", [])  # Keep parameter name for compatibility
    concise = request.get("concise", False)
    
    if not posts or len(posts) == 0:
        return {
            "error": "No posts provided",
            "analysis": "No posts were provided for analysis."
        }
    
    try:
        # Get additional context from Perplexity API
        context = get_perplexity_context(posts)
        
        # Format the posts for the prompt without numbering
        posts_text = "\n\n".join(posts)
        
        # Create a more direct prompt focused on a concise overview without referencing specific posts
        if context:
            prompt = f"""Review these social media posts:

                    {posts_text}
                    
                    Additional context about these posts:
                    {context}

                    Provide a concise 3-4 sentence overview of these posts. Focus on:
                    - The main themes or messaging
                    - What makes them effective or ineffective
                    - One specific suggestion for improvement
                    
                    Keep your response to 3-4 sentences total. Do not reference specific posts by number.
                    """
        else:
            prompt = f"""Review these social media posts:

                    {posts_text}

                    Provide a concise 3-4 sentence overview of these posts. Focus on:
                    - The main themes or messaging
                    - What makes them effective or ineffective
                    - One specific suggestion for improvement
                    
                    Keep your response to 3-4 sentences total. Do not reference specific posts by number.
                    """
        
        # Call the Fireworks AI API
        response = fireworks.client.ChatCompletion.create(
            model="accounts/fireworks/models/llama-v3p1-405b-instruct",
            messages=[
                {"role": "system", "content": "You are an expert social media analyst who provides extremely concise, insightful overviews without referencing specific posts by number."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1024,
            temperature=0.7,
        )
        
        # Extract the analysis from the response
        analysis = response.choices[0].message.content
        
        return {
            "analysis": analysis,
            "context": context
        }
        
    except Exception as e:
        print(f"Error in AI analysis: {e}")
        return {
            "error": str(e),
            "analysis": "An error occurred while analyzing the posts with AI."
        }

# Update the chat endpoint to use "posts" terminology
@app.post("/analyze/tweets/chat", response_model=Dict[str, Any])
async def chat_about_posts(
    request: Dict[str, Any],
    token: str = Depends(verify_token)
):
    """
    Chat with AI about social media posts
    """
    if not FIREWORKS_API_KEY:
        return {
            "error": "Fireworks API key not configured",
            "response": "AI chat is not available. Please configure a Fireworks API key."
        }
    
    posts = request.get("tweets", [])  # Keep parameter name for compatibility
    chat_history = request.get("chat_history", "")
    user_message = request.get("user_message", "")
    
    if not posts or not user_message:
        return {
            "error": "No posts or message provided",
            "response": "I need both posts and a message to respond to."
        }
    
    try:
        # Format the posts for the prompt
        posts_text = "\n\n".join([f"Post {i+1}: {post}" for i, post in enumerate(posts)])
        
        # Create the prompt for the LLaMA model
        prompt = f"""You are an AI assistant specializing in social media analysis. You have access to the following recent posts from an organization:

            {posts_text}

            Chat history:
            {chat_history}

            User's question: {user_message}

            Please provide a helpful, informative response about these posts based on the user's question.
            """
        
        # Call the Fireworks AI API
        response = fireworks.client.ChatCompletion.create(
            model="accounts/fireworks/models/llama-v3p1-405b-instruct",
            messages=[
                {"role": "system", "content": "You are an AI assistant specializing in social media analysis."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1024,
            temperature=0.7,
        )
        
        # Extract the response from the API
        ai_response = response.choices[0].message.content
        
        return {
            "response": ai_response
        }
        
    except Exception as e:
        print(f"Error calling Fireworks AI for chat: {e}")
        return {
            "error": str(e),
            "response": "An error occurred while processing your question."
        }

@app.get("/tweets/{id}/liking_users", response_model=Dict[str, Any])
async def get_tweet_liking_users(
    id: str,
    token: str = Depends(verify_token),
    max_results: Optional[int] = 10,
    pagination_token: Optional[str] = None,
    user_fields: Optional[List[str]] = Query(None),
    expansions: Optional[List[str]] = Query(None),
    tweet_fields: Optional[List[str]] = Query(None),
):
    """
    Get users who liked a tweet using the Twitter API
    """
    print(f"Fetching users who liked tweet ID: {id}")
    
    # Build query parameters
    params = {}
    if max_results:
        params["max_results"] = max_results
    if pagination_token:
        params["pagination_token"] = pagination_token
    if user_fields:
        params["user.fields"] = ",".join(user_fields)
    if expansions:
        params["expansions"] = ",".join(expansions)
    if tweet_fields:
        params["tweet.fields"] = ",".join(tweet_fields)
    
    # Make request to Twitter API
    url = f"{TWITTER_API_BASE}/tweets/{id}/liking_users"
    headers = {"Authorization": f"Bearer {token}"}
    
    print(f"Making request to: {url}")
    print(f"With params: {params}")
    
    result = make_twitter_request(url, headers, params)
    
    # Debug the response structure
    print(f"Liking users response structure: {list(result.keys())}")
    
    # Check if we have data
    if 'data' in result:
        like_count = len(result['data'])
        print(f"Retrieved {like_count} users who liked the tweet")
    else:
        print(f"No users found who liked the tweet. Response: {result}")
    
    return result

# Add this function to check token permissions
@app.get("/check-token", response_model=Dict[str, Any])
async def check_token_permissions(token: str = Depends(verify_token)):
    """
    Check the permissions of the provided token
    """
    try:
        # Make a request to the Twitter API to check token permissions
        url = f"{TWITTER_API_BASE}/users/me"
        headers = {"Authorization": f"Bearer {token}"}
        
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return {
                "status": "ok",
                "message": "Token is valid",
                "data": response.json()
            }
        else:
            return {
                "status": "error",
                "message": f"Token check failed with status code: {response.status_code}",
                "error": response.text
            }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Error checking token: {str(e)}"
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)