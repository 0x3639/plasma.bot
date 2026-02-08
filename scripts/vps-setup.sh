#!/usr/bin/env bash
set -euo pipefail

# ==============================================================
# VPS Setup Script for plasma.bot
# Run as root on a fresh Ubuntu 22.04/24.04 DigitalOcean droplet
#
# BEFORE RUNNING: Edit the variables below
# ==============================================================

DEPLOY_USER="deploy"
APP_DIR="/opt/plasma-bot"
REPO_URL="https://github.com/0x3639/plasma.bot.git"

echo "==> Updating system..."
apt-get update && apt-get upgrade -y

# --- 1. Create deploy user ---
echo "==> Creating deploy user..."
adduser --disabled-password --gecos "" "$DEPLOY_USER" || true
mkdir -p /home/$DEPLOY_USER/.ssh

# Copy root's authorized_keys to deploy user
# (assumes you SSH'd in with your key as root)
cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
chmod 700 /home/$DEPLOY_USER/.ssh
chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh

# --- 2. Harden SSH ---
echo "==> Hardening SSH..."
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# --- 3. Firewall ---
echo "==> Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy redirect + ACME)
ufw allow 443/tcp   # HTTPS
ufw --force enable

# --- 4. Install Docker ---
echo "==> Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add deploy user to docker group
usermod -aG docker "$DEPLOY_USER"

# --- 5. Set up wallet keyfile directory ---
echo "==> Creating keyfile directory..."
mkdir -p /etc/plasma-bot
chmod 700 /etc/plasma-bot
chown $DEPLOY_USER:$DEPLOY_USER /etc/plasma-bot

# --- 6. Clone repository ---
echo "==> Cloning repository..."
mkdir -p "$APP_DIR"
chown $DEPLOY_USER:$DEPLOY_USER "$APP_DIR"
su - $DEPLOY_USER -c "git clone $REPO_URL $APP_DIR"

# --- 7. Create frontend-dist directory ---
mkdir -p "$APP_DIR/frontend-dist"
chown $DEPLOY_USER:$DEPLOY_USER "$APP_DIR/frontend-dist"

echo ""
echo "============================================"
echo "  VPS setup complete!"
echo "============================================"
echo ""
echo "NEXT STEPS:"
echo "1. Copy your encrypted wallet.json:"
echo "   scp wallet.json deploy@$(hostname -I | awk '{print $1}'):/etc/plasma-bot/wallet.json"
echo ""
echo "2. Set file permissions:"
echo "   chmod 600 /etc/plasma-bot/wallet.json"
echo ""
echo "3. Update Caddyfile with your domain:"
echo "   nano $APP_DIR/Caddyfile"
echo ""
echo "4. Add GitHub Secrets in repo Settings → Secrets → Actions:"
echo "   VPS_HOST, VPS_SSH_KEY, KEYFILE_PASSWORD, ADMIN_API_KEY,"
echo "   MONGODB_URI, ZNN_NODE_URL, FRONTEND_URL"
echo ""
echo "5. Push to main branch to trigger first deploy"
echo ""
echo "NOTE: To add the GitHub Actions deploy key, generate one:"
echo "   ssh-keygen -t ed25519 -f deploy_key -C 'github-actions-deploy'"
echo "   Then add deploy_key.pub to /home/deploy/.ssh/authorized_keys"
echo "   And add the private key content as VPS_SSH_KEY in GitHub Secrets"
echo ""
