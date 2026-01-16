
import requests
import sys

def test_groups_endpoint():
    # Login to get token (assuming test user exists or we can sign up)
    # Actually, let's just try to hit the endpoint if we have a token, or just check the code structure visually?
    # Better: Use a simple script to verify the server is up and maybe try to hit the endpoint if we knew credentials.
    # Since we don't know user credentials easily without signup, I will rely on code correctness and unit test style if possible.
    
    # But wait, I can assume the server is running. 
    # Let's try to check the openapi.json to see if the model has changed.
    try:
        r = requests.get("http://localhost:8000/openapi.json")
        if r.status_code == 200:
            schema = r.json()
            # Check if Group model has members
            definitions = schema.get("components", {}).get("schemas", {})
            group_model = definitions.get("Group")
            if group_model:
                properties = group_model.get("properties", {})
                if "members" in properties:
                    print("✅ Group model has 'members' field.")
                    return
                else:
                    print("❌ Group model MISSING 'members' field.")
            else:
                print("❌ Group model not found in schema.")
        else:
            print(f"❌ Failed to fetch OpenAPI shema. Status: {r.status_code}")
    except Exception as e:
        print(f"❌ Connection failed: {e}")

if __name__ == "__main__":
    test_groups_endpoint()
