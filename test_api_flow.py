import requests
import os

API_URL = "http://localhost:8080"
EMAIL = "debug_auto_user@test.com"
PASSWORD = "password123"

def run():
    print(f"Testing API against {API_URL}")
    
    # 1. Signup (or Login if exists)
    print("1. Attempting Signup...")
    res = requests.post(f"{API_URL}/auth/signup", json={
        "email": EMAIL,
        "password": PASSWORD,
        "username": "DebugUser"
    })
    
    token = None
    if res.status_code == 200:
        print("   Signup Success")
        token = res.json()["access_token"]
    elif res.status_code == 400 and "already exists" in res.text:
        print("   User exists, logging in...")
        res = requests.post(f"{API_URL}/auth/login", json={
            "identifier": EMAIL,
            "password": PASSWORD
        })
        if res.status_code == 200:
            token = res.json()["access_token"]
            print("   Login Success")
        else:
            print(f"   Login Failed: {res.text}")
            return
    else:
        print(f"   Signup Failed: {res.text}")
        return

    # 2. Upload Avatar
    print("\n2. Uploading Avatar...")
    # Create a dummy image file
    with open("test_avatar.png", "wb") as f:
        # 1x1 white pixel png
        f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff\x3f\x03\x00\x05\xfe\x02\xfe\xa7\x35\x81\x84\x00\x00\x00\x00IEND\xae\x42\x60\x82')
    
    with open("test_avatar.png", "rb") as f:
        files = {"file": ("test_avatar.png", f, "image/png")}
        headers = {"Authorization": f"Bearer {token}"}
        res = requests.post(f"{API_URL}/auth/profile/avatar", files=files, headers=headers)
        
        if res.status_code == 200:
            print("   Upload Success")
            print(f"   Response: {res.json()}")
        else:
            print(f"   Upload Failed: {res.status_code} {res.text}")
            return

    # 3. Check /auth/me
    print("\n3. Verifying /auth/me...")
    headers = {"Authorization": f"Bearer {token}"}
    res = requests.get(f"{API_URL}/auth/me", headers=headers)
    if res.status_code == 200:
        data = res.json()
        print(f"   Profile Image in DB: {data.get('profile_image')}")
        
        if data.get('profile_image'):
             # 4. Check Configured URL Access
             img_path = data.get('profile_image')
             full_url = f"{API_URL}{img_path}"
             print(f"\n4. Fetching Image from {full_url}...")
             img_res = requests.get(full_url)
             if img_res.status_code == 200:
                 print("   Image Fetch Success (200 OK)")
                 print(f"   Content-Type: {img_res.headers.get('Content-Type')}")
                 print(f"   Size: {len(img_res.content)} bytes")
             else:
                 print(f"   Image Fetch Failed: {img_res.status_code}")
        else:
             print("   FAILURE: Profile Image not set in response!")
    else:
        print(f"   Get Profile Failed: {res.text}")

if __name__ == "__main__":
    run()
