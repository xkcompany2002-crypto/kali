# Publish XK-TRADE-BOT to GitHub

The project is ready to push, but a GitHub repository must exist first. Create a **private, empty** repository named `xk-trade-bot` at:

https://github.com/new

Do not initialize it with a README, `.gitignore`, or license (this project already includes those files).

## Windows PowerShell

1. Download and extract `XK-TRADE-BOT-GitHub-Upload.zip`.
2. Open PowerShell inside the extracted folder. Confirm that `Dockerfile`, `render.yaml`, `package.json`, and `server.js` are directly in that folder.
3. Replace `YOUR-USERNAME` with your GitHub username, then run:

```powershell
git init -b main
git add .
git commit -m "Initial XK-TRADE-BOT release"
git remote add origin https://github.com/YOUR-USERNAME/xk-trade-bot.git
git push -u origin main
```

If Git asks you to sign in, use Git Credential Manager/browser sign-in; never paste an access token into this project or into ChatGPT. If Git says your name/email are not configured, set them with `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then retry the commit.

## Next

Send the repository URL after the push succeeds. The Render workspace has been confirmed, and the service can then be created from that repository. The Render Blueprint expects a secret `TOKEN_HARBOR_API_KEY`; add a **newly rotated** key in Render's Environment settings, not in GitHub. A key previously pasted into a chat should be revoked.

Before sharing the public app widely, verify `/health`, a live provider request, and browser isolation after the first deploy. Free-tier hosting can sleep and may have memory constraints for Chromium.
