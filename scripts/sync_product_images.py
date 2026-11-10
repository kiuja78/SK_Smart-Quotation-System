#!/usr/bin/env python3
"""Cache exact product-photo bytes, to make client-side PNG/PDF generation CORS safe.

Usage: python3 scripts/sync_product_images.py
Runs on GitHub Actions. No credentials, image edits, or third-party image proxies.
"""
from __future__ import annotations
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib, json, mimetypes, os, subprocess, sys

ROOT=Path(__file__).resolve().parents[1]
PHOTO_ROOT=ROOT/'assets'/'product-photos'
MANIFEST=ROOT/'assets'/'product-images.json'
CATALOG_URL='https://kiuja78.github.io/skmagic-product-info/data.js'
SOURCE_BASE='https://kiuja78.github.io/skmagic-product-info/'
MAX_BYTES=8*1024*1024
MAX_URLS=260

# Validate external hosts; never use untrusted catalog URLs to request internal hosts.
ALLOWED_SUFFIXES=(
 'skmagic.com','skmagic.co.kr','skintellix.com','skmagiccdn.com',
 'github.io','githubusercontent.com','github.com','jsdelivr.net',
 'amazonaws.com','cloudfront.net', 'cafe24.com', 'imweb.me',
)

def allow_host(url):
    u=urlparse(url)
    host=(u.hostname or '').lower().rstrip('.')
    return u.scheme=='https' and u.username is None and u.password is None and (
        any(host==allowed or host.endswith('.'+allowed) for allowed in ALLOWED_SUFFIXES)
    )

def normalize_image(raw):
    if not isinstance(raw,str) or not raw.strip():return None
    value=urljoin(SOURCE_BASE, raw.strip())
    return value if allow_host(value) else None

def file_suffix(data:bytes):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):return '.png'
    if data.startswith(b'\xff\xd8\xff'):return '.jpg'
    if data[:4]==b'RIFF' and data[8:12]==b'WEBP':return '.webp'
    if data.startswith((b'GIF87a',b'GIF89a')):return '.gif'
    return None

def fetch_bytes(url, max_bytes):
    req=Request(url,headers={
      'User-Agent':'Mozilla/5.0 (compatible; SKQuoteOriginalImageCache/1.0)',
      'Accept':'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.6',
      'Referer':SOURCE_BASE
    })
    with urlopen(req,timeout=16) as resp:
        if not allow_host(resp.url):raise ValueError('redirect host not permitted')
        length=resp.headers.get('Content-Length')
        if length and int(length)>max_bytes:raise ValueError('image too large')
        data=resp.read(max_bytes+1)
        if len(data)>max_bytes:raise ValueError('image too large')
    return data

# Download the trusted source script, then run it in a limited Node VM (no Node IO inside VM).
print('Loading product information...',flush=True)
source=fetch_bytes(CATALOG_URL,3*1024*1024)
result=subprocess.run(['node',str(ROOT/'scripts'/'extract_catalog.mjs')],input=source,
                      stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
if result.returncode:
    raise RuntimeError('Catalog extraction failed: '+result.stderr.decode('utf-8','replace')[:500])
archive=json.loads(result.stdout)
months=sorted(archive.keys(),reverse=True)[:4]
products=[]
for month in months:
    for product in archive[month].get('products',[]):
        if isinstance(product,dict) and product.get('model'):
            products.append((month,product))
print('Months:',months, 'products:',len(products),flush=True)

# Preserve previous successfully downloaded originals across monthly releases.
try: previous=json.loads(MANIFEST.read_text('utf-8'))
except (FileNotFoundError,ValueError): previous={}
by_url={k:v for k,v in previous.get('byUrl',{}).items() if (ROOT/v).is_file() and allow_host(k)}
by_model={k:[p for p in v if (ROOT/p).is_file()] for k,v in previous.get('byModel',{}).items() if isinstance(v,list)}

items=[]
for month,p in products:
    gallery=p.get('galleryImages') if isinstance(p.get('galleryImages'),list) else []
    image_urls=[p.get('cover'),*gallery,p.get('imageUrl'),p.get('image'),p.get('thumbnail'),p.get('photo')]
    candidates=[]
    for raw in image_urls:
        u=normalize_image(raw)
        if u and u not in candidates:candidates.append(u)
    items.append((month,str(p['model']),candidates))

all_urls=[]
for _,_,candidates in items:
    for u in candidates:
        if u not in by_url and u not in all_urls and len(all_urls)<MAX_URLS:
            all_urls.append(u)
PHOTO_ROOT.mkdir(parents=True,exist_ok=True)

def download_one(url):
    try:
        data=fetch_bytes(url,MAX_BYTES)
        suffix=file_suffix(data)
        if suffix is None:raise ValueError('unsupported or non-image response')
        filename=hashlib.sha256(url.encode()).hexdigest()[:24]+suffix
        output=PHOTO_ROOT/filename
        if not output.exists():output.write_bytes(data)
        return url,'assets/product-photos/'+filename,None
    except Exception as exc:return url,None,str(exc)[:120]

failures=[]
with ThreadPoolExecutor(max_workers=7) as pool:
    futures=[pool.submit(download_one,url) for url in all_urls]
    for future in as_completed(futures):
        url,path,error=future.result()
        if path:by_url[url]=path
        else:failures.append((url,error))

for month,model,candidates in items:
    valid=[by_url[u] for u in candidates if u in by_url]
    if valid:by_model[month+'|'+model]=list(dict.fromkeys(valid))

result={'version':1,'updatedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        'byUrl':dict(sorted(by_url.items())),'byModel':dict(sorted(by_model.items()))}
MANIFEST.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Images cached:',len(by_url),'models mapped:',len(by_model),'failed:',len(failures),flush=True)
for url,error in failures[:15]:print('SKIPPED:',url,error)
if not by_model:raise SystemExit('No photos downloaded. Check source image server restrictions and allowlist.')
