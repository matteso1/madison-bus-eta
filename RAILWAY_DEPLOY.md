# 🚂 Railway Deployment - Quick Fix Guide

## ❌ Problem
Railway can't auto-detect how to build because your project has multiple directories (backend, frontend, ml_system).

## ✅ Solution Options

### **Option 1: Use Railway UI (EASIEST)** ⭐

1. **Go to Railway Dashboard**: https://railway.app/
2. **Click on your service** (if already created) or create new project
3. **Go to Settings**
4. **Set Root Directory**: 
   - Find "Root Directory" setting
   - Set it to: `backend`
5. **Set Start Command** (if needed):
   - Start Command: `gunicorn app:app`
6. **Add Environment Variables**:
   ```
   MADISON_METRO_API_KEY=your_key_here
   FLASK_ENV=production
   PORT=5000
   ```
7. **Redeploy**

### **Option 2: Use Configuration Files** (Automated)

I just created `railway.json` and `nixpacks.toml` for you. Push these to GitHub:

```bash
cd "C:\Users\nilsm\Desktop\VSCODE PROJECTS\madison-bus-eta"
git add railway.json nixpacks.toml RAILWAY_DEPLOY.md
git commit -m "Add Railway configuration files"
git push origin main
```

Then Railway will automatically know how to build!

### **Option 3: Deploy Backend as Separate Service**

If Railway still has issues:

1. **Create a new Railway project**
2. **Instead of connecting the whole repo**:
   - Click "Deploy from GitHub repo"
   - Select `madison-bus-eta`
   - **Important**: In the setup, click "Configure" 
   - Set **Root Directory** to `backend`
3. **Railway will now only look at the backend folder**

---

## 🔧 What the Config Files Do

### `railway.json`
Tells Railway:
- Build command: Install Python packages from `backend/requirements.txt`
- Start command: Run Gunicorn from the `backend` directory
- Restart policy: Retry on failure

### `nixpacks.toml`
Tells Railway's Nixpacks builder:
- Use Python 3.13
- Install dependencies from backend
- Run Gunicorn on the correct port

---

## 🚀 Quick Deploy Steps

### Method 1: Fix Current Deployment

If you already started deploying:

1. Go to Railway dashboard
2. Click your service
3. **Settings** → **Root Directory** → Set to `backend`
4. **Settings** → **Start Command** → Set to `gunicorn app:app`
5. Click **Deploy** again

### Method 2: Fresh Start (RECOMMENDED)

1. **Delete current Railway service** (if it failed)
2. **Push the config files I just created**:
   ```bash
   cd "C:\Users\nilsm\Desktop\VSCODE PROJECTS\madison-bus-eta"
   git add railway.json nixpacks.toml RAILWAY_DEPLOY.md
   git commit -m "Add Railway deployment configuration"
   git push origin main
   ```
3. **Create new Railway project**:
   - Click "New Project"
   - "Deploy from GitHub repo"
   - Select `madison-bus-eta`
   - Railway will auto-detect the config files! ✨
4. **Add environment variables** (see below)
5. **Deploy**!

---

## 📝 Environment Variables to Add

In Railway dashboard → Your service → Variables:

```
MADISON_METRO_API_KEY=your_api_key_here
FLASK_ENV=production
```

**Note**: `PORT` is automatically set by Railway, you don't need to add it.

---

## ✅ Verification

After deployment, test these URLs (replace with your Railway URL):

1. **Health Check**:
   ```
   https://your-app.railway.app/ml/status
   ```
   Should return:
   ```json
   {
     "ml_available": true,
     "smart_ml_improvement": 21.3
   }
   ```

2. **Routes Endpoint**:
   ```
   https://your-app.railway.app/routes
   ```

---

## 🔍 Troubleshooting

### Issue: "Script start.sh not found"
**Solution**: Use Option 1 or Option 2 above. Railway needs to know which directory to use.

### Issue: "Module not found" errors
**Solution**: Make sure Root Directory is set to `backend` or config files are pushed.

### Issue: "Port already in use"
**Solution**: Railway sets $PORT automatically. Make sure your `app.py` uses:
```python
port = int(os.environ.get('PORT', 5000))
app.run(host='0.0.0.0', port=port)
```
(Already done in your app.py! ✅)

### Issue: "Gunicorn not found"
**Solution**: Make sure `gunicorn` is in `backend/requirements.txt` (it is! ✅)

---

## 🎯 Recommended Approach

**Do this right now:**

1. Push the config files:
   ```bash
   cd "C:\Users\nilsm\Desktop\VSCODE PROJECTS\madison-bus-eta"
   git add railway.json nixpacks.toml RAILWAY_DEPLOY.md
   git commit -m "Add Railway deployment configuration"
   git push origin main
   ```

2. Go to Railway and start fresh:
   - Delete any failed deployments
   - Create new project from GitHub
   - Select your repo
   - Railway will auto-detect the configs! ✨

3. Add environment variables (optional for demo):
   ```
   FLASK_ENV=production
   ```

4. Deploy and get your URL!

---

## 🚀 Alternative: Deploy to Render Instead

If Railway continues to give you trouble, **Render** is easier for Python apps:

1. **Go to Render.com**
2. **New → Web Service**
3. **Connect your GitHub repo**
4. **Settings**:
   - Name: `madison-bus-eta-api`
   - Environment: `Python 3`
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app`
5. **Create Web Service** (Free tier!)
6. **Add environment variables** if needed

Render automatically handles Python apps better than Railway sometimes.

---

## 📋 Summary

**Problem**: Railway doesn't know which folder to deploy  
**Solution**: Tell it to use `backend` folder  
**How**: Use config files OR set Root Directory in Railway UI  

**Next Step**: Push the config files and redeploy! 🚀

---

**After Railway works, you'll have your backend URL to use in Vercel frontend deployment!**

