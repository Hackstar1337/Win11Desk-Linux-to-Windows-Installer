#!/usr/bin/env python3
from pathlib import Path
import zipfile,hashlib,json,stat,os
root=Path(__file__).resolve().parents[1];out=root.parent/'artifacts';out.mkdir(exist_ok=True)
selected=[]
for folder in ['client','shared','server','vendor','drizzle','patches','deploy','scripts','test']:
 for p in (root/folder).rglob('*'):
  if p.is_file() and not p.name.startswith('.env') and not any(x in p.parts for x in ['node_modules','__pycache__','.git','.manus']):selected.append(p)
for name in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','drizzle.config.ts','vite.config.ts','vitest.config.ts','components.json','Dockerfile','.gitattributes','compose.yaml','.dockerignore','.env.example','.gitignore','README.md','START-HERE.md','DEPLOY.md','TEST-REPORT.md','HISTORY-PROGRESS-RELEASE.md','DEPLOYMENT-PROFILES-GUIDE.md','OPERATIONS-GUIDE.md','READY-OS-GUIDE.md','CODE-REVIEW-ALIGNMENT.md','ALPINE-MEDIA-FIX.md','DASHBOARD-CUSTOMIZATION.md','POST-INSTALL-GUIDE.md','TESTING-DOMAIN.md','CHROME-STARTUP-REPAIR.md','PREFLIGHT-REPAIR.md','REMOTE-SSH-LAUNCH-REPAIR.md','REAL-REMOTE-INSTALL-RESULT.md','WIN11DESK-VERSION-2-GUIDE.md','WIN11DESK-VERSION-2-PLAN.md','PRIVATE-SETUP-GUIDE.md', 'CHROME-CLEAN-COMMAND-FIX.md','ATTACHED-SCRIPT-AWK-FIX.md','DESKTOP-INSTALLERS-POST-INSTALL-PLAN.md','operations-status/README.md','DEPLOYMENT-PROFILES-PLAN.md','HISTORY-PROGRESS-UPGRADE.md','ADMIN-DASHBOARD-PLAN.md','LICENSE']:
 p=root/name
 if p.exists():selected.append(p)
exclude={'monitorVpsInstall.py','monitorInstallTest.py','waitRdpReady.py','verifyRdpTest.py','verifyTicketDelivery.ts','verifyAutomaticTracking.ts','verifyReusableDelivery.ts','verifyPageDelivery.ts','verifyDefaultIso.py','downloadProgress.ts','download-progress.html'}
selected=[p for p in set(selected) if p.name not in exclude and not p.name.endswith(('.iso','.pyc'))]
for name in ['OPERATIONS-MAINTENANCE-GUIDE.md', 'VENGEANCE-UI-SOURCES.md', 'VENGEANCE-UI-RELEASE.md', 'COMPACT-LAYOUT-RELEASE.md', 'UI-LAUNCH-REPAIR.md', 'SSH-AND-CLARITY-RELEASE.md']:
 guide=root/name
 if guide.exists():selected.append(guide)
# Never embed private credential fixtures in a distributable release builder.
private_keys = ['VAULT_KEY','DB_PASSWORD','DB_ROOT_PASSWORD','DATABASE_URL','BOOTSTRAP_SECRET','CREDENTIAL_VAULT_KEY','SESSION_KEY','JWT_SECRET',
                'SPACESHIP_API_KEY','SPACESHIP_API_SECRET','OPENAI_API_KEY']
private_values = [os.environ.get(name, '').encode() for name in private_keys]
private_values += [str(value).encode() for value in json.loads(os.environ.get('RELEASE_PRIVATE_SCAN_VALUES', '[]'))]
private_values = [value for value in private_values if len(value) >= 12]
for p in selected:
 if any(value in p.read_bytes() for value in private_values):
  raise SystemExit('Private credential detected in '+str(p))
archive=out/'Win11Desk-Standalone-Deploy.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(selected):
  info=zipfile.ZipInfo.from_file(p,'win11desk/'+p.relative_to(root).as_posix())
  info.external_attr=(stat.S_IFREG | (0o755 if p.suffix=='.sh' else 0o644)) << 16
  info.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(info,p.read_bytes())
 manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(selected)}
 info=zipfile.ZipInfo('win11desk/RELEASE-MANIFEST.json');info.external_attr=(stat.S_IFREG|0o644)<<16;info.compress_type=zipfile.ZIP_DEFLATED
 z.writestr(info,json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 assert all(((i.external_attr>>16)&0o444)==0o444 for i in z.infolist() if not i.is_dir()), 'Release source must remain readable in non-root images'
 assert all('win11desk/'+x in z.namelist() for x in ['deploy/start.sh','compose.yaml','Dockerfile','TEST-REPORT.md','server/control/schema.sql','server/control/admin-schema.sql','server/control/extra-schema.sql'])
 assert not any(n.endswith('/.env') or 'node_modules/' in n for n in z.namelist())
hashfile=out/'Win11Desk-Standalone-Deploy.zip.sha256';hashfile.write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
print('Verified:',archive,'files',len(selected),'bytes',archive.stat().st_size);print('Checksum:',hashfile)
