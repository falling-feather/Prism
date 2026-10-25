"""Bounded local import snapshots. Browser filenames are labels, never filesystem paths."""
from pathlib import Path
import hashlib,json,os,re,threading,time,uuid

class RecentImports:
    def __init__(self, root, limit=12):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.limit=limit;self.lock=threading.RLock()

    def _records(self):
        index=self.root/'index.json'
        if not index.exists():return []
        data=json.loads(index.read_text(encoding='utf-8'))
        if not isinstance(data,list) or any(not isinstance(r,dict) or not re.fullmatch(r'[a-f0-9]{24}',str(r.get('id',''))) for r in data):
            raise ValueError('最近导入记录损坏，请重新导入工程')
        return data[:self.limit]

    def _write(self,path,data):
        temporary=self.root/(uuid.uuid4().hex+'.tmp')
        try:
            with temporary.open('w',encoding='utf-8') as stream:json.dump(data,stream,ensure_ascii=False)
            os.replace(temporary,path)
        finally:temporary.unlink(missing_ok=True)

    def remember(self, project, name, kind='file', location=''):
        if not isinstance(project,dict) or project.get('schema')!='svgfilm-project':
            raise ValueError('最近导入须包含有效工程')
        if kind not in ('file','source'):raise ValueError('导入类型无效')
        name=str(name)[:255];location=str(location or name)[:1000]
        token=hashlib.sha256((kind+'\0'+location+'\0'+name).encode('utf-8')).hexdigest()[:24]
        with self.lock:
            records=[r for r in self._records() if r['id']!=token]
            self._write(self.root/(token+'.project.json'),project)
            records.insert(0,{'id':token,'name':name,'kind':kind,'location':location,'title':str(project.get('title',''))[:255],'importedAt':int(time.time()*1000)})
            self._write(self.root/'index.json',records[:self.limit])
            for item in records[self.limit:]:(self.root/(item['id']+'.project.json')).unlink(missing_ok=True)
        return token

    def list(self):
        with self.lock:
            return [{**r,'available':(self.root/(r['id']+'.project.json')).is_file()} for r in self._records()]

    def project(self,token):
        with self.lock:
            if not re.fullmatch(r'[a-f0-9]{24}',token) or not any(r['id']==token for r in self._records()):raise ValueError('导入记录不存在')
            path=self.root/(token+'.project.json')
            if not path.is_file():raise ValueError('本机导入副本已缺失，请重新选择工程')
            return json.loads(path.read_text(encoding='utf-8'))
