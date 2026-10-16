#!/usr/bin/env python3
"""Build local dependency archives from verified upstream tarballs and reviewed patches.
Run before npm ci in a clean checkout. Never modifies installed node_modules.
"""
import base64,gzip,hashlib,io,json,os,subprocess,tarfile,tempfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
MANIFEST=ROOT/'vendor/native/sources.json'
OUT=ROOT/'.native-deps'
def source(key,meta):
 cache=OUT/'cache'/f'{key}.tgz';cache.parent.mkdir(parents=True,exist_ok=True)
 if not cache.exists():
  raw=urllib.request.urlopen(meta['url'],timeout=120).read()
  verify(raw,meta);cache.write_bytes(raw)
 raw=cache.read_bytes();verify(raw,meta);return raw
def verify(raw,meta):
 actual='sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()
 if actual!=meta['integrity']:raise RuntimeError('Dependency integrity mismatch: '+meta['package'])
def archive(folder,target):
 # Stable byte representation makes npm lock integrity portable across machines.
 with target.open('wb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w',format=tarfile.GNU_FORMAT) as tar:
  for p in sorted(folder.rglob('*')):
   if not p.is_file():continue
   info=tar.gettarinfo(str(p),'package/'+str(p.relative_to(folder)))
   info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0
   with p.open('rb') as f:tar.addfile(info,f)
def main():
 manifest=json.loads(MANIFEST.read_text());OUT.mkdir(exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='caya-native-build-') as temp:
  for key in ['mineflayer','data']:
   dest=Path(temp)/key;dest.mkdir();raw=source(key,manifest[key])
   with tarfile.open(fileobj=io.BytesIO(raw)) as t:t.extractall(dest,filter='data')
   package=dest/'package'
   for patch in sorted((ROOT/'vendor/native').glob('*.patch')):
    if key=='mineflayer' and patch.name.startswith('mf-') or key=='data' and patch.name.startswith('data-'):
     subprocess.run(['git','apply','--check',str(patch)],cwd=package,check=True)
     subprocess.run(['git','apply',str(patch)],cwd=package,check=True)
   if key=='data' and (ROOT/'vendor/native/repair-data.py').exists():
    official=source('official-data',manifest['official-data']);ref=Path(temp)/'official-data';ref.mkdir()
    with tarfile.open(fileobj=io.BytesIO(official)) as t:
     names=['package/minecraft-data/data/pc/26.1/blocks.json','package/minecraft-data/data/pc/26.1/items.json']
     for name in names:t.extract(name,ref,filter='data')
    subprocess.run(['python3',str(ROOT/'vendor/native/repair-data.py'),str(package),str(ref/'package')],check=True)
   archive(package,OUT/(key+'.tgz'))
   print(key,manifest[key]['version'],hashlib.sha512((OUT/(key+'.tgz')).read_bytes()).hexdigest()[:16])
if __name__=='__main__':main()
