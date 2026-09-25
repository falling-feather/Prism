# 工程数据协议：SVGFilm 0.3.0

关键词：schema、sources、scenes、texts、objects、objectOverrides、subtitles、audioTracks。

## 版本与文件

主交付是 UTF-8 JSON，文件名推荐 `作品名.svgfilm.json`。顶层是对象；无注释、NaN、Infinity、函数、外部资源路径或 Markdown 围栏。以下类型表描述生产者应输出的契约，校验工具还会验证 SVG 和实际节点绑定。

| 字段 | 类型与要求 |
| --- | --- |
| schema | 固定字符串 `svgfilm-project` |
| schemaVersion | 固定字符串 `0.3.0` |
| projectId | 非空稳定字符串；每部作品独立 |
| title | 人类可读作品名称 |
| canvas | `{width,height,fps,background}`；width／height为64–4096的数字，推荐整数；fps为1–60；background为有效CSS颜色 |
| workflow | 可省略；若提供，推荐 `{"script":{"status":"needs-review"}}`。该状态不是本协议的创作审批步骤 |
| sources | 以sourceId为键的来源对象；通用来源见下一节 |
| scenes | 1–500个按播放顺序排列的剪辑对象；格式见下表 |
| audioTracks | 0–16个全片音轨对象；没有声音时为 `[]` |
| captionStyle | 可省略；可提供 `{size,font,fill}`，默认28px及工作台默认字体、颜色。使用有效颜色和实际安装的字体 |

工程JSON不得超过120 MiB；全片不得超过7200秒。单音频导入上限80 MiB，内嵌base64后的累计工程预算优先。字体可使用本机具体字体，也可使用sans-serif／serif等通用字体族；通用字体由浏览器选择可用字体。字体不自动打包，跨机器需要相同字体或接受替代字体。

新版工作台可迁移0.2工程并保留既有ID。生产者创建通用动画时必须标0.3.0；不能只改版本号把未知格式冒充兼容工程。旧0.2工作台不支持本动画来源，需要先升级。

## sources：素材与动画

sourceId匹配 `^[A-Za-z][A-Za-z0-9_-]{0,95}$`，例如 `circuit`。每项通用来源包含：

| 字段 | 类型与要求 |
| --- | --- |
| type | 固定 `svg-keyframes-v1`；静止镜头也可使用该类型，animations设为 `[]` |
| duration | 来源时长，0.01–7200秒 |
| svg | 完整SVG字符串；viewBox、ID、文字和资源要求见SVG接口 |
| animations | 动画目标数组；结构见动画接口；最多2000个目标 |

一个来源可由多幕引用。来源存放原始图形和运动；不同剪辑的文字修改和布局覆盖互相独立。

兼容来源 `svg` 仅提供静态画面，使用旧的自动序号；新作者建议统一使用有稳定ID的 `svg-keyframes-v1`。`cell-native-v1` 是工作台随附的专用细胞适配器，不是通用制作入口，不能拿它表示新题材。

## scenes：剪辑与编辑数据

| 字段 | 类型与要求 |
| --- | --- |
| id | 全工程内唯一、非空、稳定字符串 |
| sourceId | 必须引用sources中的键 |
| name | 镜头列表中的名称 |
| in / out | 来源入点／出点，`0 ≤ in`、`in + 0.01 ≤ out ≤ source.duration` |
| hold | 末尾停留秒数，0–600；首次建议明确写0 |
| texts | 所有画面文字的可编辑记录；首次交付可为 `[]` |
| objects | 所有可编辑组件的记录；首次交付可为 `[]` |
| objectOverrides | 对象ID到编辑覆盖的映射；首次为 `{}` |
| subtitles | 字幕对象数组，没有时为 `[]` |

三个时钟必须区分：

- 镜头时长 `out - in + hold`；全片镜头起点由之前镜头的时长求和，不存储第二份全片 `start`。
- 对当前剪辑局部时间local，来源时间为 `in + min(local, out-in)`；SVG动画和画面文字显隐使用来源时间。末尾停留固定在out处。
- 字幕使用当前剪辑局部时间；音乐／配音使用全片时间。修改镜头顺序或时长不会隐式平移音轨。

拆分／裁剪由工作台维护字幕重定位。已被裁掉的字幕通过撤销恢复；延长剪辑不会凭空重建已删除的字幕。原始SVG和动画来源不会被裁剪改写。

## 文字与组件清单

初次创建时，把全部真实文字直接写进SVG，用 `texts: []`、`objects: []`、`objectOverrides: {}`。工作台首次载入会从SVG登记清单，再保存工程便得到完整记录。不要猜测登记出的几何中心。

新版绑定公式：SVG节点id为 `label`、来源id为 `circuit`，则对象ID为 `circuit:o:label`；如果它是text节点，文字ID为 `circuit:t:label`，objectId为 `circuit:o:label`。改变SVG节点排列不会改变这些ID。图形、文字和注册表不能引用不匹配的编号。

保存后的记录：

- `objects[]`：`{id,label,parentId,cx,cy}`。parentId是最近可编辑祖先的对象ID，根组件为null；cx/cy是基础几何在该组件父坐标中的中心。清单须完整；中心为有限数字。
- `texts[]`：`{id,objectId,text,x,y,size,font,fill,anchor,width,start,end}`。text是唯一可编辑正文；x/y为父SVG文本坐标，范围±20000；size为4–500；width为0–20000，0表示不自动折行；anchor为start／middle／end；font为本机字体族列表，fill为颜色。start/end是来源时间上的可见区间，含start、不含end；默认0到1000000000，保证停留阶段仍可显示。
- `objectOverrides[id]`：可含 `dx,dy,scale,rotation,hidden`。dx/dy为父坐标下相对位移（±20000），scale为0.05–20（1为原大小），rotation为角度（±20000），hidden为布尔值。未提供字段按0／1／false处理。只可引用objects中的有效ID。

不要同时手写半份清单让工作台补剩余部分：首次用完整空数组，或保留完整的已有登记结果。教师修改后，`texts`和`objectOverrides`是编辑状态；清空它们会丢失修改。整体缩放是编辑覆盖的计算方式，不新增永久SVG分组。

## 字幕与声音

字幕记录为 `{id,text,start,end}`，id在所属剪辑内唯一。`0 ≤ start < end ≤ 镜头时长`，最小时长0.001秒。正文换行用 `\n`；不要再提供另一份rows。字幕作为独立覆盖层绘制；不要在SVG底部再烘焙一份相同字幕。

音轨记录：

| 字段 | 类型与要求 |
| --- | --- |
| id / name | 唯一稳定ID／可读名称 |
| kind | `music`或`voice` |
| dataUrl | 完整 `data:audio/<mime>;base64,...`；推荐audio/wav、audio/mpeg、audio/mp4，使用浏览器和FFmpeg均可解码的真实音频 |
| start | 全片开始时间，0–7200秒 |
| offset | 源音频入点，0–7200秒 |
| duration | 使用长度，0.01–7200秒；offset+duration不得超过音源真实长度 |
| mediaDuration | 音源真实长度，有限正数；新作者应填写，避免无法确定延长边界 |
| volume | 0–1 |
| muted | 布尔值 |
| fadeIn / fadeOut | 0到duration，线性淡入淡出；重叠时两个包络相乘 |

声音禁止使用伪base64或不含素材的占位URL。没有音乐／配音时交付空数组，不为了满足字段而生成无用音轨。
