import json, time, urllib.request, os
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765')
project={'schema':'svgfilm-project','schemaVersion':'0.2.0','projectId':'independent','title':'独立工程','canvas':{'width':1280,'height':720,'fps':10,'background':'#ffffff'},'sources':{'diagram':{'type':'svg','duration':2,'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect x="200" y="200" width="300" height="200" fill="#46735c"/><text x="200" y="170" font-size="40">独立教学工程</text></svg>'}},'scenes':[{'id':'one','sourceId':'diagram','name':'独立镜头','in':0,'out':2,'hold':0,'texts':[],'objects':[],'objectOverrides':{},'subtitles':[{'id':'sub','text':'导出与预览共享画面','start':0,'end':2}]}],'audioTracks':[]}
request=urllib.request.Request(URL+'/api/exports',data=json.dumps({'project':project,'width':640,'start':0,'end':1}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request) as r: job=json.load(r)['id']
for _ in range(90):
    with urllib.request.urlopen(URL+'/api/exports/'+job) as r: status=json.load(r)
    if status['status'] in ('complete','failed','cancelled'):break
    time.sleep(1)
assert status['status']=='complete',status
with urllib.request.urlopen(URL+'/api/exports/'+job+'/download') as r: assert r.headers['Content-Type']=='video/mp4'; assert len(r.read())>1000
print(json.dumps({'independent_export':True,'job':job},ensure_ascii=False))
