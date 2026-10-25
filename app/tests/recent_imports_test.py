from pathlib import Path
import sys,tempfile,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from recent_imports import RecentImports

class RecentImportsTests(unittest.TestCase):
    def test_deduplicate_bound_and_restore_after_restart(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'.work') as temporary:
            root=Path(temporary); recent=RecentImports(root,limit=2)
            p={'schema':'svgfilm-project','title':'测试','sources':{},'scenes':[]}
            first=recent.remember(p,'a.prism','file','a.prism')
            recent.remember(p,'b.prism','file','b.prism')
            self.assertEqual(recent.remember(p,'a.prism','file','a.prism'),first)
            self.assertEqual(len(recent.list()),2)
            recent.remember(p,'c.prism','file','c.prism')
            restored=RecentImports(root,limit=2)
            self.assertEqual([r['name'] for r in restored.list()],['c.prism','a.prism'])
            self.assertEqual(len(list(root.glob('*.project.json'))),2)
            self.assertEqual(restored.project(first)['title'],'测试')
            with self.assertRaises(ValueError):restored.project('../outside')
            (root/(first+'.project.json')).unlink()
            self.assertFalse(next(r for r in restored.list() if r['id']==first)['available'])
            with self.assertRaisesRegex(ValueError,'重新'):restored.project(first)

if __name__=='__main__':unittest.main()
