import os
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import json

# Load environment variables from the .env file
load_dotenv()

ACCESS_TOKEN = os.getenv('META_ACCESS_TOKEN')
AD_ACCOUNT_ID = os.getenv('META_AD_ACCOUNT_ID') 
API_VERSION = 'v19.0' # Using the current Meta Graph API version
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

app = FastAPI(title="Facebook Ads Manager API")

# Mount the static directory to serve CSS and JS files
app.mount("/static", StaticFiles(directory="static"), name="static")

class BudgetUpdate(BaseModel):
    campaign_id: str
    daily_budget_dollars: float

class PublishConfig(BaseModel):
    name: str # Campaign Name
    daily_budget_dollars: float
    countries: List[str] # e.g. ["US", "IL"]
    primary_text: str
    headline: str
    link_url: str
    image_hash: str

@app.get("/")
def serve_dashboard():
    """Serve the main HTML dashboard."""
    return FileResponse("static/index.html")

@app.get("/health")
def health_check():
    """Health check endpoint for Railway to verify the app is running."""
    return {"status": "ok", "message": "Facebook Ads Bot API is running!"}

@app.post("/api/upload-media")
async def upload_media(file: UploadFile = File(...)):
    """Uploads an image to the Meta Ad Account and returns the image hash."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported currently.")
        
    url = f"{BASE_URL}/{AD_ACCOUNT_ID}/adimages"
    
    # Read file content safely
    contents = await file.read()
    
    files = {
        'filename': (file.filename, contents, file.content_type)
    }
    data = {
        'access_token': ACCESS_TOKEN
    }
    
    response = requests.post(url, data=data, files=files)
    result = response.json()
    
    if response.status_code == 200 and 'images' in result:
        # FB returns a dict keyed by the original filename
        img_data = list(result['images'].values())[0]
        return {"status": "success", "hash": img_data['hash'], "url": img_data['url']}
    else:
        raise HTTPException(status_code=response.status_code, detail=result)

@app.post("/api/publish-campaign")
def publish_new_campaign(config: PublishConfig):
    """Executes the full chain to create a PAUSED campaign -> adset -> ad."""
    
    # 1. Create Campaign
    camp_url = f"{BASE_URL}/{AD_ACCOUNT_ID}/campaigns"
    camp_data = {
        'access_token': ACCESS_TOKEN,
        'name': f"{config.name} (Auto-Botito)",
        'objective': 'OUTCOME_TRAFFIC',
        'status': 'PAUSED', # Keep paused for safety review
        'special_ad_categories': '[]'
    }
    camp_res = requests.post(camp_url, data=camp_data)
    if camp_res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to create Campaign: {camp_res.json()}")
    new_campaign_id = camp_res.json()['id']
    
    # 2. Create Ad Set
    adset_url = f"{BASE_URL}/{AD_ACCOUNT_ID}/adsets"
    daily_budget_cents = int(config.daily_budget_dollars * 100)
    adset_data = {
        'access_token': ACCESS_TOKEN,
        'name': f"{config.name} - AdSet",
        'campaign_id': new_campaign_id,
        'daily_budget': daily_budget_cents,
        'billing_event': 'IMPRESSIONS',
        'optimization_goal': 'LINK_CLICKS',
        'bid_amount': 20, # 20 cents bid cap (required for some traffic goals, or switch to auto-bid)
        'status': 'PAUSED',
        'targeting': json.dumps({'geo_locations': {'countries': config.countries}})
    }
    
    # Attempt absolute lowest cost bidding for traffic without bid_amount limit
    adset_data.pop('bid_amount')
    adset_data['bid_strategy'] = 'LOWEST_COST_WITHOUT_CAP'
    
    adset_res = requests.post(adset_url, data=adset_data)
    if adset_res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to create AdSet: {adset_res.json()}")
    new_adset_id = adset_res.json()['id']
    
    # 3. Create Ad Creative (Link image, text, and URL)
    creative_url = f"{BASE_URL}/{AD_ACCOUNT_ID}/adcreatives"
    creative_data = {
        'access_token': ACCESS_TOKEN,
        'name': f"{config.name} - Creative",
        'object_story_spec': json.dumps({
            'page_id': '1646199073235451', # Hardcoded user's page from previous conversation context
            'link_data': {
                'image_hash': config.image_hash,
                'link': config.link_url,
                'message': config.primary_text,
                'name': config.headline
            }
        })
    }
    creative_res = requests.post(creative_url, data=creative_data)
    if creative_res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to create Creative: {creative_res.json()}")
    new_creative_id = creative_res.json()['id']
    
    # 4. Create Final Ad
    ad_url = f"{BASE_URL}/{AD_ACCOUNT_ID}/ads"
    ad_data = {
        'access_token': ACCESS_TOKEN,
        'name': f"{config.name} - Final Ad",
        'adset_id': new_adset_id,
        'creative': json.dumps({'creative_id': new_creative_id}),
        'status': 'PAUSED'
    }
    ad_res = requests.post(ad_url, data=ad_data)
    if ad_res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to create Ad: {ad_res.json()}")
        
    return {
        "status": "success",
        "message": "Campaign structure created successfully and is currently PAUSED.",
        "campaign_id": new_campaign_id
    }

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
