# Deployment Guide - Madison Metro ML

## Overview

This guide covers deploying the Madison Metro ML project to various platforms for a live demo. The project consists of a React frontend and Flask backend.

---

## 🌐 **Deployment Options**

### **Option 1: Vercel (Frontend) + Heroku (Backend) - RECOMMENDED**

#### Frontend (Vercel)
1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Deploy Frontend**:
   ```bash
   cd frontend
   vercel
   ```

3. **Configure Environment Variables**:
   - `REACT_APP_API_URL`: Your Heroku backend URL

#### Backend (Heroku)
1. **Install Heroku CLI**:
   ```bash
   # Download from https://devcenter.heroku.com/articles/heroku-cli
   ```

2. **Create Heroku App**:
   ```bash
   cd backend
   heroku create madison-metro-ml-api
   ```

3. **Set Environment Variables**:
   ```bash
   heroku config:set MADISON_METRO_API_KEY=your_api_key
   heroku config:set FLASK_ENV=production
   ```

4. **Deploy**:
   ```bash
   git add .
   git commit -m "Deploy to Heroku"
   git push heroku main
   ```

### **Option 2: Netlify (Frontend) + Railway (Backend)**

#### Frontend (Netlify)
1. **Build the project**:
   ```bash
   cd frontend
   npm run build
   ```

2. **Deploy to Netlify**:
   - Drag and drop the `build` folder to Netlify
   - Or connect your GitHub repository

3. **Set Environment Variables**:
   - `REACT_APP_API_URL`: Your Railway backend URL

#### Backend (Railway)
1. **Connect GitHub repository**
2. **Set environment variables**:
   - `MADISON_METRO_API_KEY`
   - `FLASK_ENV=production`
3. **Deploy automatically**

### **Option 3: Docker (Full Stack)**

#### Local Docker
```bash
# Build and run
docker-compose up -d

# Access
# Frontend: http://localhost:3000
# Backend: http://localhost:5000
```

#### Cloud Docker (AWS/GCP/Azure)
1. **Build Docker images**
2. **Push to container registry**
3. **Deploy to cloud container service**

---

## Configuration

### **Environment Variables**

#### Frontend (.env)
```env
REACT_APP_API_URL=https://your-backend-url.herokuapp.com
```

#### Backend (.env)
```env
MADISON_METRO_API_KEY=your_madison_metro_api_key
FLASK_ENV=production
```

### **API Configuration**

Update the frontend API base URL in:
- `frontend/src/App.js`
- `frontend/src/api.js`

---

## 📱 **Mobile Responsiveness**

The frontend is fully responsive and works on:
- **Desktop** (1200px+)
- **Tablet** (768px - 1199px)
- **Mobile** (320px - 767px)

---

## 🔒 **Security Considerations**

### **Production Checklist**
- [ ] Set `FLASK_ENV=production`
- [ ] Use HTTPS for all endpoints
- [ ] Implement API rate limiting
- [ ] Add CORS configuration
- [ ] Secure environment variables
- [ ] Enable error logging

### **CORS Configuration**
```python
# In backend/app.py
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["https://your-frontend-url.vercel.app"])
```

---

## Monitoring & Analytics

### **Health Checks**
- **Backend**: `GET /health`
- **Frontend**: Built-in React error boundaries

### **Logging**
- **Backend**: Flask logging to stdout
- **Frontend**: Console logging for development

### **Performance Monitoring**
- **API Response Time**: <200ms target
- **Frontend Load Time**: <3s target
- **Uptime**: 99.9% target

---

## 🚨 **Troubleshooting**

### **Common Issues**

#### Frontend Won't Load
- Check `REACT_APP_API_URL` environment variable
- Verify backend is running and accessible
- Check browser console for errors

#### Backend API Errors
- Verify `MADISON_METRO_API_KEY` is set
- Check API rate limits
- Review backend logs

#### CORS Issues
- Update CORS configuration in backend
- Check allowed origins
- Verify HTTPS/HTTP protocol mismatch

### **Debug Commands**

#### Backend
```bash
# Check logs
heroku logs --tail

# Check environment variables
heroku config

# Restart app
heroku restart
```

#### Frontend
```bash
# Check build
npm run build

# Test locally
npm start

# Check environment variables
echo $REACT_APP_API_URL
```

---

## Performance Optimization

### **Frontend**
- **Code splitting** with React.lazy()
- **Image optimization** for maps
- **Bundle analysis** with webpack-bundle-analyzer
- **CDN** for static assets

### **Backend**
- **Database connection pooling**
- **API response caching**
- **Background task processing**
- **Load balancing** for multiple instances

---

## 🔄 **CI/CD Pipeline**

### **GitHub Actions Example**
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}

  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to Heroku
        uses: akhileshns/heroku-deploy@v3.12.12
        with:
          heroku_api_key: ${{ secrets.HEROKU_API_KEY }}
          heroku_app_name: "madison-metro-ml-api"
          heroku_email: "your-email@example.com"
```

---

## 📞 **Support**

### **Deployment Issues**
- **GitHub Issues**: [Create an issue](https://github.com/yourusername/madison-bus-eta/issues)
- **Email**: your.email@example.com
- **Documentation**: [Full docs](https://github.com/yourusername/madison-bus-eta)

### **Platform Support**
- **Vercel**: [Vercel Docs](https://vercel.com/docs)
- **Heroku**: [Heroku Docs](https://devcenter.heroku.com)
- **Netlify**: [Netlify Docs](https://docs.netlify.com)
- **Railway**: [Railway Docs](https://docs.railway.app)

---

## Quick Start Commands

### **Local Development**
```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py

# Frontend
cd frontend
npm install
npm start
```

### **Production Deployment**
```bash
# Frontend (Vercel)
cd frontend
vercel

# Backend (Heroku)
cd backend
heroku create your-app-name
git push heroku main
```

---

**Your Madison Metro ML project is now ready for production deployment!**

*For more detailed instructions, refer to the platform-specific documentation or create an issue for help.*
