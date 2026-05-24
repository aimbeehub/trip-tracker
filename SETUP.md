# Trip Fund Tracker - Setup & Deployment Guide

This guide explains how to set up Trip Fund Tracker on GitHub and deploy to Vercel.

---

## 📁 Repository Structure

```
trip_tracker/
├── index.html                             # Landing page (Vercel root)
├── trip-fund-tracker-dashboard.html       # Main application
├── README.md                              # Main documentation
├── INDEX.md                               # Project index
├── LICENSE                                # MIT License
├── package.json                           # Node config
├── vercel.json                            # Vercel configuration
├── .gitignore                             # Git ignore rules
├── .vercelignore                          # Vercel ignore rules
├── .htaccess                              # Apache server config
└── SETUP.md                               # This file
```

---

## 🚀 Quick Start

### Step 1: Create GitHub Repository

1. Go to [GitHub.com](https://github.com/new)
2. Create new repository named `trip_tracker`
3. Initialize with README (optional)

### Step 2: Clone & Add Files

```bash
# Clone the repository
git clone https://github.com/yourusername/trip_tracker.git
cd trip_tracker

# Copy all files from outputs directory
cp -r /path/to/outputs/* .

# Or manually copy:
# - trip-fund-tracker-dashboard.html
# - README.md
# - INDEX.md
# - index.html
# - vercel.json
# - package.json
# - .gitignore
# - .vercelignore
# - .htaccess
# - LICENSE
```

### Step 3: Configure & Commit

```bash
# Configure git (first time only)
git config user.name "Your Name"
git config user.email "your@email.com"

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Add Trip Fund Tracker application and documentation"

# Push to GitHub
git push -u origin main
```

### Step 4: Connect to Vercel

1. Go to [Vercel.com](https://vercel.com)
2. Sign up with GitHub account
3. Click "New Project"
4. Select `trip_tracker` repository
5. Click "Import"
6. No changes needed (detects vercel.json)
7. Click "Deploy"

---

## ✅ Verification Checklist

After deployment, verify the following:

### GitHub Repository
- [ ] All files present in repository
- [ ] No sensitive information in files
- [ ] .gitignore is properly configured
- [ ] LICENSE file is present

### Vercel Deployment
- [ ] Landing page loads at root URL (`https://yoursite.com`)
- [ ] App loads at `/trip-fund-tracker-dashboard.html`
- [ ] No 404 errors
- [ ] Vercel shows successful deployment in dashboard

### File Accessibility
- [ ] `index.html` serves as landing page
- [ ] `trip-fund-tracker-dashboard.html` loads correctly
- [ ] `README.md` is visible in GitHub
- [ ] `INDEX.md` is visible in GitHub
- [ ] `vercel.json` configuration applied

---

## 🔧 Key Configuration Files Explained

### `vercel.json`
Controls Vercel deployment:
- Routes requests to correct files
- Sets cache headers
- Configures security headers
- Handles SPA routing

```json
{
  "rewrites": [
    {
      "source": "/",
      "destination": "/index.html"
    },
    {
      "source": "/app",
      "destination": "/trip-fund-tracker-dashboard.html"
    }
  ]
}
```

### `package.json`
Defines project metadata:
- Project name and description
- Version number
- Scripts for local development
- Repository information
- License (MIT)

### `.gitignore`
Prevents committing unnecessary files:
- Node modules
- Build files
- IDE settings
- OS files
- Backup files

### `.vercelignore`
Tells Vercel what to skip during deployment:
- Old version files
- Test files
- Environment files
- Node modules

### `index.html`
Landing page that loads before the main app:
- Welcomes users
- Explains features
- Links to the application
- Professional design

---

## 🌐 Access URLs

After deployment on Vercel:

| Path | File | Purpose |
|------|------|---------|
| `/` | `index.html` | Landing page |
| `/trip-fund-tracker-dashboard.html` | Main app | Finance tracker |
| `/README.md` | Documentation | Features & guide |
| `/INDEX.md` | Project index | Navigation |

---

## 🐛 Troubleshooting 404 Errors

### Problem: Getting 404 on root URL

**Solution:** Make sure `index.html` is in the root directory and `vercel.json` has correct rewrite rules.

**Check:**
1. `index.html` exists in repository root
2. `vercel.json` has proper rewrites
3. Redeploy after adding files: `vercel --prod`

### Problem: App page showing 404

**Solution:** Verify `trip-fund-tracker-dashboard.html` exists in root and has no typos.

**Check:**
1. File name is exactly `trip-fund-tracker-dashboard.html`
2. No spaces or special characters in file name
3. File is in repository root (not in subdirectory)

### Problem: Vercel showing "Not Found"

**Solution:** Check Vercel deployment logs and re-deploy.

**Steps:**
1. Go to Vercel dashboard
2. Select `trip_tracker` project
3. Check "Deployments" tab for errors
4. Click "Redeploy" on latest deployment
5. Monitor deployment logs

---

## 📝 First-Time Setup Notes

1. **Update `vercel.json`** — Ensure rewrite rules match your file names
2. **Update `package.json`** — Replace `yourusername` with actual GitHub username
3. **Update repository links** — Change URL in documentation to your repo
4. **Test locally first** — Run `npm run dev` before pushing
5. **Check file sizes** — Keep HTML files under 1MB for best performance

---

## 🔐 Security Considerations

### GitHub
- [ ] No API keys in files
- [ ] No personal information in code
- [ ] .gitignore configured properly
- [ ] License file included

### Vercel
- [ ] Security headers enabled
- [ ] Cache control configured
- [ ] HTTPS enforced
- [ ] No sensitive environment variables

### Application
- [ ] All data stored locally (localStorage)
- [ ] No external API calls (except Chart.js CDN)
- [ ] No user data transmission
- [ ] No tracking or analytics

---

## 🚀 Optimization Tips

### Performance
1. Minify HTML before deployment
2. Use CSS and JS files locally (avoid CDN when possible)
3. Optimize images in landing page
4. Enable caching in vercel.json

### SEO
1. Add meta tags to index.html
2. Update description in package.json
3. Create sitemap.xml
4. Add robots.txt

### Maintenance
1. Keep README.md updated
2. Maintain changelog
3. Monitor GitHub issues
4. Tag releases on GitHub

---

## 📞 Support & Troubleshooting

### Common Issues

**Q: Getting 404 errors**
A: Check vercel.json rewrites and ensure all files are committed to GitHub

**Q: Landing page not showing**
A: Verify index.html exists and vercel.json has correct root rewrite

**Q: App not loading**
A: Check browser console for errors, ensure trip-fund-tracker-dashboard.html is accessible

**Q: Data not persisting**
A: Verify browser localStorage is enabled, check browser permissions

### Resources

- [Vercel Documentation](https://vercel.com/docs)
- [GitHub Help](https://docs.github.com)
- [Web App Deployment Guide](https://developer.mozilla.org/en-US/docs/Learn/Common_questions/Tools_and_setup/How_do_you_host_your_website_on_Google_Profiles)

---

## 📋 Deployment Checklist

Before deploying to production:

- [ ] All files committed to GitHub
- [ ] vercel.json configured correctly
- [ ] index.html landing page created
- [ ] trip-fund-tracker-dashboard.html tested locally
- [ ] README.md and INDEX.md updated
- [ ] LICENSE file included
- [ ] .gitignore properly configured
- [ ] No API keys or secrets in code
- [ ] Tested on multiple browsers
- [ ] Mobile responsiveness verified
- [ ] All links working (internal and external)
- [ ] No console errors in DevTools
- [ ] Data persistence tested
- [ ] Export/import functionality tested

---

## 🎉 Success!

Once deployed, your site will be live at your Vercel URL. Share it with others!

- **Share Link:** `https://yourdomain.vercel.app`
- **GitHub Repo:** `https://github.com/yourusername/trip_tracker`
- **Documentation:** `https://yourdomain.vercel.app/README.md`

---

*Last Updated: May 2026 | Version 1.0.0*
