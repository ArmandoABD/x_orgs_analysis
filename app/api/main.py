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

app = FastAPI(title="Twitter API Proxy")

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
    Get tweets from a user using the real Twitter API
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
    
    result = make_twitter_request(url, headers, params)
    tweet_count = len(result.get('data', [])) if 'data' in result else 0
    print(f"Retrieved {tweet_count} tweets")
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 