import os
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Load environment variables from the .env file
load_dotenv()

ACCESS_TOKEN = os.getenv('META_ACCESS_TOKEN')
AD_ACCOUNT_ID = os.getenv('META_AD_ACCOUNT_ID') 
API_VERSION = 'v19.0' # Using the current Meta Graph API version

app = FastAPI(title="Facebook Ads Manager API")

class BudgetUpdate(BaseModel):
    campaign_id: str
    daily_budget_dollars: float

@app.get("/")
def read_root():
    """Health check endpoint for Railway to verify the app is running."""
    return {"status": "ok", "message": "Facebook Ads Bot is running!"}

@app.get("/test-connection")
def test_connection():
    """Test the connection to the Facebook Ads API by fetching campaigns."""
    if not ACCESS_TOKEN or 'your_access_token_here' in ACCESS_TOKEN:
        raise HTTPException(status_code=500, detail="Error: Please set up the META_ACCESS_TOKEN in the environment")

    url = f"https://graph.facebook.com/{API_VERSION}/{AD_ACCOUNT_ID}/campaigns"
    params = {
        'access_token': ACCESS_TOKEN,
        'fields': 'id,name,status,objective'
    }
    
    response = requests.get(url, params=params)
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.json())
        
    data = response.json()
    campaigns = data.get('data', [])
    return {"status": "success", "campaigns": campaigns}

@app.post("/update-budget")
def update_campaign_budget(request: BudgetUpdate):
    """Update daily budget for the entire campaign (if using CBO)."""
    # Facebook API expects budget in cents/pence
    daily_budget_cents = int(request.daily_budget_dollars * 100)
    
    update_url = f"https://graph.facebook.com/{API_VERSION}/{request.campaign_id}"
    update_params = {
        'access_token': ACCESS_TOKEN,
        'daily_budget': daily_budget_cents
    }
    
    response = requests.post(update_url, data=update_params)
    data = response.json()
    
    if response.status_code == 200 and data.get('success'):
        return {"status": "success", "message": f"Successfully updated Campaign {request.campaign_id} budget to ${request.daily_budget_dollars}/day"}
    else:
        raise HTTPException(status_code=response.status_code, detail=data)

@app.get("/insights/{campaign_id}")
def get_campaign_insights(campaign_id: str):
    """Fetch real-time analytics data for the campaign."""
    url = f"https://graph.facebook.com/{API_VERSION}/{campaign_id}/insights"
    params = {
        'access_token': ACCESS_TOKEN,
        'fields': 'spend,impressions,clicks,reach,cpc,ctr',
        'date_preset': 'maximum' # Get lifetime data or replace with 'today'
    }
    
    response = requests.get(url, params=params)
    data = response.json()
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=data)
        
    insights = data.get('data', [])
    if not insights:
        return {"message": "No insights data available yet."}
        
    # Usually insights returns a list with 1 item for the total
    return {"status": "success", "insights": insights[0]}
