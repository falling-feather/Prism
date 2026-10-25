# 工程数据协议：SVGFilm 0.4.0

关键词：schema、sources、scenes、texts、objects、objectOverrides、subtitles、audioTracks。

## 版本与文件

小工程使用 UTF-8 JSON，文件名推荐 `作品名.svgfilm.json`；独立素材使用 `.prism` 工程包。顶层是对象；无注释、NaN、Infinity、函数值或 Markdown 围栏。Canvas 程序作为其 program 字段中的字符串提供。素材通过 resources 清单登记，不能提供任意 HTTP 地址或本机绝对路径。

| 字段 | 类型与要求 |
| --- | --- |
| schema | 固定字符串 `svgfilm-project` |
| schemaVersion | 新工程为 `0.4.0`；工作台仍读取 0.2.0／0.3.0 |
| projectId | 非空稳定字符串；每部作品独立 |
| title | 人类可读作品名称 |
| canvas | `{width,height,fps,background}`；width／height为64–4096的数字，推荐整数；fps为1–60；background为有效CSS颜色 |
| workflow | 可省略；若提供，推荐 `{"script":{"status":"needs-review"}}`。该状态不是本协议的创作审批步骤 |
| sources | 以sourceId为键的来源对象；通用来源见下一节 |
| resources | 可省略；独立图片、音频、字体的资源表，格式见下文 |
| scenes | 1–500个按播放顺序排列的剪辑对象；格式见下表 |
| audioTracks | 0–16个全片音轨对象；没有声音时为 `[]` |
| captionStyle | 可省略；可提供 `{size,font,fill}`，默认28px及工作台默认字体、颜色。使用有效颜色和实际安装的字体 |

工程JSON不得超过120 MiB；全片不得超过7200秒。独立单音频上限2 GiB，单图片或字体上限80 MiB，工程包及其解压总大小不超过4 GiB；内嵌base64仍计入JSON预算。Canvas 字体可以随素材登记；SVG 文字使用本机字体，跨机器仍需相同字体或接受替代字体。

新版工作台迁移0.2／0.3工程并保留既有ID。独立资源与Canvas来源必须使用0.4.0；不能只改版本号把未知格式冒充兼容工程。旧版工作台不能读取新增来源，需要先升级。

## sources：素材与动画

sourceId匹配 `^[A-Za-z][A-Za-z0-9_-]{0,95}$`，例如 `circuit`。SVG来源包含下表字段；Canvas使用[Canvas接口](canvas.md)。一个工程可混合不同来源。

| 字段 | 类型与要求 |
| --- | --- |
| type | 固定 `svg-keyframes-v1`；静止镜头也可使用该类型，animations设为 `[]` |
| duration | 来源时长，0.01–7200秒 |
| svg | 完整SVG字符串；viewBox、ID、文字和资源要求见SVG接口 |
| animations | 动画目标数组；结构见动画接口；最多2000个目标 |

一个来源可由多幕引用。来源存放原始图形和运动；不同剪辑的文字修改和布局覆盖互相独立。

兼容来源 `svg` 仅提供静态画面，使用旧的自动序号；新SVG作者使用有稳定ID的 `svg-keyframes-v1`。`cell-native-v1` 是工作台随附的专用细胞适配器，不是通用制作入口，不能拿它表示新题材。

## resources：独立素材

以稳定资源编号为键，每项含 `name`、`mime`，以及以下一种来源：

- 自包含JSON：`dataUrl`，完整的对应MIME类型base64数据。
- 工程包清单：`path`，相对ZIP根目录的素材路径，例如 `assets/portrait.png`。只允许包内真实文件。
- 工作台本机状态：`assetId`，导入后由服务登记的内容哈希；不要把只有assetId的JSON作为跨电脑交付。点击保存会生成携带素材的工程包。

资源编号沿用sourceId规则；最多5000项。内置适配器使用PNG、JPEG、WebP、GIF图片，浏览器和FFmpeg可解码的音频，以及TTF／OTF／WOFF／WOFF2字体。资源表也允许video／model类型、application/json和application/octet-stream供扩展适配器使用；存入资源表不代表已有对应编辑能力。Canvas通过source.assets中的别名引用图片与字体；音轨通过resourceId引用音频。

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
| parameterOverrides | 可省略；对象完整ID到参数值映射，字段必须由来源声明；Canvas参数接口见专门说明 |
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
- `texts[]`：`{id,objectId,text,x,y,size,font,fill,anchor,width,start,end}`。text是唯一可编辑正文；x/y为父SVG文本坐标，范围±20000；size为0.01–4096（普通文字建议使用可读字号；较小值用于原生动画过渡）；width为0–20000，0表示不自动折行；anchor为start／middle／end；font为本机字体族列表，fill为颜色。start/end是来源时间上的可见区间，含start、不含end；默认0到1000000000，保证停留阶段仍可显示。
- `objectOverrides[id]`：可含 `dx,dy,scale,rotation,hidden`。dx/dy为父坐标下相对位移（±20000），scale为0.05–20（1为原大小），rotation为角度（±20000），hidden为布尔值。未提供字段按0／1／false处理。只可引用objects中的有效ID。

不要同时手写半份清单让工作台补剩余部分：首次用完整空数组，或保留完整的已有登记结果。教师修改后，`texts`和`objectOverrides`是编辑状态；清空它们会丢失修改。整体缩放是编辑覆盖的计算方式，不新增永久SVG分组。

## 字幕与声音

字幕记录为 `{id,text,start,end}`，id在所属剪辑内唯一。`0 ≤ start < end ≤ 镜头时长`，最小时长0.001秒。正文换行用 `\n`；不要再提供另一份rows。字幕作为独立覆盖层绘制；不要在SVG底部再烘焙一份相同字幕。

音轨记录：

| 字段 | 类型与要求 |
| --- | --- |
| id / name | 唯一稳定ID／可读名称 |
| kind | `music`或`voice` |
| dataUrl / resourceId | 二选一。dataUrl为完整 `data:audio/<mime>;base64,...`；resourceId引用resources中的音频。推荐audio/wav、audio/mpeg、audio/mp4，须为真实可解码音频 |
| start | 全片开始时间，0–7200秒 |
| offset | 源音频入点，0–7200秒 |
| duration | 使用长度，0.01–7200秒；offset+duration不得超过音源真实长度 |
| mediaDuration | 音源真实长度，有限正数；新作者应填写，避免无法确定延长边界 |
| volume | 0–1 |
| muted | 布尔值 |
| fadeIn / fadeOut | 0到duration，线性淡入淡出；重叠时两个包络相乘 |

声音禁止使用伪base64或不含素材的占位URL。没有音乐／配音时交付空数组，不为了满足字段而生成无用音轨。
