import os
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import json
import google.generativeai as genai

# Load environment variables from the .env file
load_dotenv()

ACCESS_TOKEN = os.getenv('META_ACCESS_TOKEN')
AD_ACCOUNT_ID = os.getenv('META_AD_ACCOUNT_ID') 
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
API_VERSION = 'v19.0' # Using the current Meta Graph API version
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

# Configure Gemini
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="Facebook Ads Manager API")

# Mount the static directory to serve CSS and JS files
app.mount("/static", StaticFiles(directory="static"), name="static")

class BudgetUpdate(BaseModel):
    campaign_id: str
    daily_budget_dollars: float

class TargetingRequest(BaseModel):
    product_desc: str
    audience_desc: str
    budget_desc: str

class GuidedPublishConfig(BaseModel):
    name: str
    daily_budget_dollars: float
    targeting_json: dict # Comes from the AI (contains min_age, max_age, geo_locations structure)
    primary_text: str
    headline: str
    link_url: str
    image_hash: str

def resolve_city_keys(city_names: List[str]) -> List[dict]:
    """Uses Meta Search API to turn city names into precise Facebook Ad Location Keys."""
    if not city_names:
        return []
        
    resolved_cities = []
    url = f"{BASE_URL}/search"
    
    for city in city_names:
        params = {
            'type': 'adgeolocation',
            'q': city,
            'location_types': "['city']",
            'access_token': ACCESS_TOKEN
        }
        try:
            res = requests.get(url, params=params)
            data = res.json()
            if 'data' in data and len(data['data']) > 0:
                # Take the best match (first result)
                match = data['data'][0]
                resolved_cities.append({
                    "key": match['key'],
                    "radius": 15, # Default radius in KM
                    "distance_unit": "kilometer" 
                })
        except Exception as e:
            print(f"Failed to resolve city {city}: {e}")
            
    return resolved_cities

@app.get("/")
def serve_dashboard():
    """Serve the main HTML dashboard with no-cache headers."""
    response = FileResponse("static/index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.get("/health")
def health_check():
    """Health check endpoint for Railway to verify the app is running."""
    return {"status": "ok", "message": "Facebook Ads Bot API is running!"}

@app.post("/api/analyze-targeting")
def analyze_targeting(request: TargetingRequest):
    """Uses Gemini AI to act as a marketing expert that extracts targeting configurations and generates copy."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API Key is not configured on the server.")
        
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        system_prompt = """
        You are an elite digital marketing manager for Facebook Ads.
        Your job is to read user interviews about their business and translate them into a strictly structured JSON configuration for a Facebook Ad campaign.
        
        RULES:
        1. Always write the text (headline, primary_text) in highly persuasive, grammatically perfect Hebrew.
        2. Extract an age range logical for the product (min_age 18 to 65).
        3. Guess the Facebook country code (e.g. "IL" for Israel, "US" for USA).
        4. Extract any city names mentioned into a list of strings (in English or the native language, Meta Search API accepts both).
        5. Evaluate the user's budget answer. Recommend a logical 'daily_budget_dollars' as a number.
        
        OUTPUT FORMAT (Return ONLY this raw JSON, no markdown blocks):
        {
            "headline": "A catchy, short headline (max 5 words) in Hebrew",
            "primary_text": "A persuasive 2-3 sentence ad body text ending with a call to action in Hebrew.",
            "min_age": 18,
            "max_age": 65,
            "geo_locations": {
                "countries": ["IL"],
                "cities": ["Tel Aviv", "Jerusalem"]
            },
            "daily_budget_dollars": 50
        }
        """
        
        user_input = f"""
        Product Description: {request.product_desc}
        Target Audience & Location: {request.audience_desc}
        Budget Expectations: {request.budget_desc}
        """
        
        response = model.generate_content(f"{system_prompt}\n{user_input}")
        
        # Parse the JSON response
        try:
            text_resp = response.text.strip()
            if text_resp.startswith("```json"):
                text_resp = text_resp.replace("```json", "", 1).replace("```", "")
            if text_resp.startswith("```"):
                text_resp = text_resp.replace("```", "", 1).replace("```", "")
            
            ai_data = json.loads(text_resp)
            return {"status": "success", "analysis": ai_data}
        except json.JSONDecodeError:
            print("Failed to parse Gemini response:", response.text)
            raise HTTPException(status_code=500, detail="AI generated invalid format.")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
def publish_new_campaign(config: GuidedPublishConfig):
    """Executes the full chain to create a PAUSED campaign -> adset -> ad."""
    
    # Extract Guided AI Targeting
    target_data = config.targeting_json
    geo_locations = {
        "countries": target_data.get("geo_locations", {}).get("countries", ["IL"])
    }
    
    cities = target_data.get("geo_locations", {}).get("cities", [])
    if cities:
        resolved_cities = resolve_city_keys(cities)
        if resolved_cities:
            geo_locations["cities"] = resolved_cities
            # If we specific cities, sometimes FB gets angry if we also list the country broadly.
            # But the documentation allows sending countries + cities. For safety, let's keep both.

    targeting_payload = {
        'geo_locations': geo_locations,
        'age_min': target_data.get('min_age', 18),
        'age_max': target_data.get('max_age', 65)
    }

    # 1. Create Campaign
    camp_url = f"{BASE_URL}/{AD_ACCOUNT_ID}/campaigns"
    camp_data = {
        'access_token': ACCESS_TOKEN,
        'name': f"{config.name} (Botito Guided)",
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
        'name': f"{config.name} - Targeted AdSet",
        'campaign_id': new_campaign_id,
        'daily_budget': daily_budget_cents,
        'billing_event': 'IMPRESSIONS',
        'optimization_goal': 'LINK_CLICKS',
        'bid_strategy': 'LOWEST_COST_WITHOUT_CAP',
        'status': 'PAUSED',
        'targeting': json.dumps(targeting_payload)
    }
    
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
