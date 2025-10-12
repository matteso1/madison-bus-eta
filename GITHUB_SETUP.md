# GitHub Repository Setup Guide

## What Will Be Committed

The `.gitignore` is configured to include **code and documentation** while excluding **large data files and models**.

### Included (will be committed):
- ✅ All Python source code (`.py` files)
- ✅ Configuration files (`.json`, `.yaml`, `.txt`)
- ✅ Documentation (`.md` files)
- ✅ Frontend code (React components)
- ✅ Project structure and organization
- ✅ Small metadata files
- ✅ Requirements files

### Excluded (will NOT be committed):
- ❌ Large CSV data files (`backend/collected_data/*.csv`)
- ❌ ML model files (`backend/ml/models/*.pkl` - 200+ MB)
- ❌ Encoder files (`backend/ml/encoders/*.pkl`)
- ❌ Processed data (`backend/ml/data/*.csv`)
- ❌ Kaggle dataset folder (`backend/kaggle_dataset/`)
- ❌ Virtual environments (`venv/`, `node_modules/`)
- ❌ Environment variables (`.env`)
- ❌ Cache files (`__pycache__/`, `.pyc`)

## Steps to Push to GitHub

### 1. Stage the important files
```bash
# Navigate to project root
cd "C:\Users\nilsm\Desktop\VSCODE PROJECTS\madison-bus-eta"

# Add all new files (respects .gitignore)
git add .

# Add modified files
git add -u
```

### 2. Review what will be committed
```bash
git status
```

Make sure:
- No large `.csv` files appear
- No `.pkl` model files appear
- Only code and documentation files are staged

### 3. Commit your changes
```bash
git commit -m "Add ML prediction system with 21.3% improvement over API

- Implemented complete ML pipeline (data collection, feature engineering, training)
- Trained 4 models (XGBoost, LightGBM, Random Forest, Gradient Boosting)
- All models beat Madison Metro API baseline
- Created production Flask API with enhanced prediction endpoints
- Prepared clean dataset for Kaggle publication
- Added comprehensive documentation"
```

### 4. Push to GitHub
```bash
git push origin main
```

If you get an error about divergent branches, you may need to pull first:
```bash
git pull origin main --rebase
git push origin main
```

## Repository Size

After excluding large files, your repository should be approximately:
- **Code and documentation:** ~5-10 MB
- **Without models/data:** Lightweight and fast to clone

## Sharing Large Files

For recruiters or collaborators who want the trained models or dataset:

### Option 1: Google Drive / Dropbox
Upload the following to cloud storage:
- `backend/ml/models/` (trained models)
- `backend/kaggle_dataset/` (clean dataset)

### Option 2: Kaggle Dataset
Publish the dataset on Kaggle and link to it in your README

### Option 3: GitHub Releases
Create a GitHub release with attached model files (if under 2GB)

## Verifying Repository

After pushing, verify on GitHub:
1. Go to https://github.com/matteso1/madison-bus-eta
2. Check that:
   - README displays properly
   - Code files are present
   - No large files were accidentally committed
   - File structure makes sense

## Repository Size Check

Before pushing, check repository size:
```bash
git count-objects -vH
```

Should be under 50 MB for optimal performance.

## Troubleshooting

### If you accidentally committed large files:

```bash
# Remove from git history (before pushing)
git rm --cached backend/ml/models/*.pkl
git rm --cached backend/collected_data/*.csv
git commit -m "Remove large files from git"
```

### If repository is too large:

Use Git LFS (Large File Storage):
```bash
git lfs install
git lfs track "*.pkl"
git lfs track "*.csv"
git add .gitattributes
git commit -m "Add Git LFS tracking"
```

## Quick Reference

**To commit everything (respecting .gitignore):**
```bash
git add .
git commit -m "Your commit message"
git push origin main
```

**To see what will be committed:**
```bash
git status
```

**To undo staging:**
```bash
git reset HEAD <file>
```

## Post-Push Checklist

- [ ] README displays correctly on GitHub
- [ ] Code is properly highlighted
- [ ] Links in README work
- [ ] Repository size is reasonable (under 100 MB)
- [ ] No sensitive data (API keys) committed
- [ ] License file is present
- [ ] Contributing guide is accessible

## Next Steps After Pushing

1. **Update GitHub repo description:** "ML system improving bus arrival predictions by 21.3% using XGBoost"
2. **Add topics:** `machine-learning`, `xgboost`, `public-transit`, `python`, `flask`, `data-science`
3. **Enable GitHub Pages** (optional) for project documentation
4. **Create GitHub Release** with trained models as attachments
5. **Share on LinkedIn** with link to repository

## Need Help?

If you encounter issues:
1. Check `.gitignore` is working: `git check-ignore backend/ml/models/xgboost_arrival_model.pkl` (should return the path)
2. Verify git status: `git status` (should not show `.csv` or `.pkl` files)
3. Check file sizes: `ls -lh backend/ml/models/` 

Good luck with your push!

