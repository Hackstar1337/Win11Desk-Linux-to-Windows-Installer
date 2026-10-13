#!/usr/bin/env python3
import secrets,os,re
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'.env'
if p.exists():raise SystemExit('.env exists; retain keys and edit deliberately. Do not regenerate over existing data.')
domain=input('Dashboard domain (installer.example.com): ').strip().lower()
if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}',domain):raise SystemExit('Enter domain only, not URL.')
data=input('Persistent data root [/srv/win11desk]: ').strip() or '/srv/win11desk'
if not data.startswith('/') or any(c in data for c in ' \n\r#$'):raise SystemExit('Use safe absolute path.')
password=secrets.token_hex(24);bootstrap=secrets.token_hex(32)
values={'APP_DOMAIN':domain,'APP_PUBLIC_URL':'https://'+domain,'DATABASE_URL':'mysql://win11desk:'+password+'@database:3306/win11desk','DB_PASSWORD':password,'DB_ROOT_PASSWORD':secrets.token_hex(32),'VAULT_KEY':secrets.token_hex(32),'BOOTSTRAP_SECRET':bootstrap,'DATA_ROOT':data,'TRUST_PROXY':'1','ALLOW_HTTP_DEV':'0','EMBEDDED_PREVIEW':'0','NODE_ENV':'production'}
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
 for k,v in values.items():f.write(k+'='+v+'\n')
print('Restricted .env created; no admin account yet. Open https://'+domain+'/setup after start.')
print('Private one-time setup secret: '+bootstrap)
print('Back up VAULT_KEY separately; never regenerate while retaining encrypted data.')
