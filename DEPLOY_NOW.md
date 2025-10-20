# 🚀 Deploy Madison Metro ML - Quick Start Guide

## What We're Deploying

- **Frontend (React)** → Vercel (free, easy, perfect for React)
- **Backend (Flask + ML)** → Railway or Render (free tier available)

---

## Option 1: Vercel + Railway (RECOMMENDED)

### Step 1: Deploy Backend to Railway

1. **Go to Railway**: https://railway.app/
2. **Sign up** with GitHub
3. **Click "New Project"** → "Deploy from GitHub repo"
4. **Select** `madison-bus-eta` repository
5. **Select** `backend` folder as root directory
6. **Add Environment Variables**:
   ```
   MADISON_METRO_API_KEY=your_api_key_here
   FLASK_ENV=production
   PORT=5000
   ```
7. **Deploy** - Railway will auto-detect Python and use requirements.txt
8. **Copy your Railway URL** (e.g., `https://madison-bus-eta-production.up.railway.app`)

### Step 2: Deploy Frontend to Vercel

1. **Go to Vercel**: https://vercel.com/
2. **Sign up** with GitHub
3. **Click "New Project"**
4. **Import** `madison-bus-eta` repository
5. **Configure**:
   - Framework Preset: **Create React App**
   - Root Directory: **frontend**
   - Build Command: `npm run build`
   - Output Directory: `build`
6. **Add Environment Variable**:
   ```
   REACT_APP_API_URL=<your-railway-url-from-step-1>
   ```
   Example: `https://madison-bus-eta-production.up.railway.app`
7. **Deploy**
8. **Your app is live!** 🎉

---

## Option 2: Vercel + Render

### Step 1: Deploy Backend to Render

1. **Go to Render**: https://render.com/
2. **Sign up** with GitHub
3. **Click "New +" → "Web Service"**
4. **Connect** `madison-bus-eta` repository
5. **Configure**:
   - Name: `madison-bus-eta-api`
   - Environment: `Python 3`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app`
   - Root Directory: `backend`
6. **Add Environment Variables**:
   ```
   MADISON_METRO_API_KEY=your_api_key_here
   FLASK_ENV=production
   ```
7. **Create Web Service** (Free tier available)
8. **Copy your Render URL**

### Step 2: Deploy Frontend to Vercel
(Same as Option 1, Step 2 above)

---

## Option 3: All-in-One Vercel Deployment

**Note**: Vercel can host both, but backend needs serverless functions (more complex setup)

For simplicity, we recommend **Option 1** (Railway + Vercel)

---

## Testing Your Deployment

### Test Backend API

```bash
# Replace with your Railway/Render URL
curl https://your-backend-url.railway.app/ml/status

# Expected response:
{
  "ml_available": true,
  "model_loaded": true,
  "smart_ml_available": true,
  "smart_ml_improvement": 21.3
}
```

### Test Frontend

1. Go to your Vercel URL (e.g., `https://madison-bus-eta.vercel.app`)
2. Check that all tabs load:
   - ✅ Live Map
   - ✅ ML Analytics
   - ✅ Statistics
   - ✅ About

---

## Troubleshooting

### Backend Issues

**Problem**: "Model not found" error
**Solution**: Make sure your `backend/ml/models/` and `backend/ml/encoders/` folders are being deployed

**Problem**: Backend takes forever to start
**Solution**: First request loads the ML model (can take 10-30 seconds). Subsequent requests will be fast.

**Problem**: "ModuleNotFoundError"
**Solution**: Check that `requirements.txt` includes all dependencies

### Frontend Issues

**Problem**: "Failed to fetch" errors
**Solution**: 
1. Check that `REACT_APP_API_URL` environment variable is set in Vercel
2. Make sure the backend URL is correct and includes `https://`
3. Check that backend CORS is configured (it is in your app.py)

**Problem**: Map not loading
**Solution**: Check browser console for errors. Leaflet CSS might need to be added.

---

## Environment Variables Summary

### Backend (Railway/Render)
```env
MADISON_METRO_API_KEY=<your-madison-metro-api-key>
FLASK_ENV=production
PORT=5000
```

**Note**: You can deploy without `MADISON_METRO_API_KEY` for demo purposes. The ML model will still work, but live bus data won't update.

### Frontend (Vercel)
```env
REACT_APP_API_URL=<your-backend-url>
```

Example: `https://madison-bus-eta-production.up.railway.app`

---

## Cost Breakdown

- **Vercel (Frontend)**: FREE ✅
  - Generous free tier
  - Unlimited bandwidth
  - Automatic HTTPS
  
- **Railway (Backend)**: FREE for 500 hours/month ✅
  - Good free tier
  - Easy deployment
  - Auto-scaling

- **Total Cost**: $0/month for personal projects 🎉

---

## Post-Deployment Checklist

- [ ] Backend is live and `/ml/status` endpoint works
- [ ] Frontend is live and loads all tabs
- [ ] ML Analytics page shows model comparison
- [ ] Add deployment URL to README.md
- [ ] Add deployment URL to LinkedIn
- [ ] Add deployment URL to resume
- [ ] Test on mobile devices
- [ ] Share with friends/professors for feedback

---

## Updating Your Deployment

### Backend Changes
```bash
git add .
git commit -m "Update backend"
git push origin main
```
Railway/Render will automatically redeploy!

### Frontend Changes
```bash
git add .
git commit -m "Update frontend"
git push origin main
```
Vercel will automatically redeploy!

---

## Need Help?

- **Railway Docs**: https://docs.railway.app/
- **Render Docs**: https://render.com/docs
- **Vercel Docs**: https://vercel.com/docs
- **Your README**: Check `DEPLOYMENT_GUIDE.md` for more details

---

## 🎯 Next Steps After Deployment

1. **Update README.md**:
   ```markdown
   ## 🌐 Live Demo
   
   **Frontend**: https://madison-bus-eta.vercel.app
   **Backend API**: https://your-backend.railway.app
   
   Try it out! Select a route and see real-time bus tracking with ML-enhanced predictions.
   ```

2. **LinkedIn Post**:
   - Include screenshot
   - Link to live demo
   - Highlight key metrics

3. **Resume**:
   - Add project with deployment link
   - Use bullets from `PORTFOLIO_GUIDE.md`

4. **Personal Website**:
   - Add project card
   - Embed or link to live demo

---

**Let's get your project live! Follow Option 1 (Railway + Vercel) and you'll be deployed in 15 minutes.** 🚀

