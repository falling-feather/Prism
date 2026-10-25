# SVGFilm AI 引导协议 · 0.4.0

你正在为 映物 Prism 制作可编辑视频。请先遵守以下工程接口，再执行用户另行给出的题材、风格与文稿要求。交付自包含 `.svgfilm.json` 或含独立素材的 `.prism`；不要只交播放视频。本文包含 SVG 与 Canvas 协议和完整示例，无需安装 Skill 或读取其他链接。

本文件由工作区 Skill 的权威参考自动生成。

---

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

sourceId匹配 `^[A-Za-z][A-Za-z0-9_-]{0,95}$`，例如 `circuit`。SVG来源包含下表字段；Canvas使用Canvas接口。一个工程可混合不同来源。

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

---

# SVG 对象接口：svg-keyframes-v1

## 坐标与稳定身份

根节点必须是SVG命名空间 `http://www.w3.org/2000/svg` 的svg，viewBox明确写 `0 0 canvas.width canvas.height`。不嵌套另一层svg。基础布局使用SVG坐标和transform属性。

画面中所有 `g、text、rect、circle、ellipse、path、polygon、polyline、line、image、use` 都必须有稳定、唯一的id，匹配 `^[A-Za-z][A-Za-z0-9_-]{0,95}$`。defs／clipPath／mask／marker／pattern／filter内部图形属于资源，不登记成画面组件；有id的资源也必须遵守同样的唯一性与格式。

一组应共同操作的形状放入有id的g；内部形状也分别给id，以支持深入部件编辑。可以用 `data-object="人类可读组件名称"` 指定列表名称。不要把整部影片压成一个无法区分的path或位图。每次重生成保留有对应关系的ID。

## 真正可编辑的文字

标题、标注、气泡、题目、答案等全部使用 `text`，字符保留为Unicode正文。不要转成轮廓路径、图片或逐字use字形。text必须有id，首次由工作台登记textContent和字体／位置。

换行可使用tspan；每行统一字号、颜色和字体。若一段文字必须混合独立样式，将其拆成多个text节点。工作台改字会按统一样式与行宽重新排版，复杂富文本片段不能保证改字后保持原有内部排版。textPath不属于此版接口。文字不能放在defs等资源中供use复用。

## 支持的图形和资源

支持基础图形、g、text/tspan、内嵌栅格image、use，以及defs、clipPath、mask、marker、pattern、linearGradient、radialGradient、stop、title、desc、metadata。支持静态filter及feGaussianBlur、feDropShadow、feColorMatrix、feOffset、feFlood、feComposite、feBlend、feMerge、feMergeNode。

资源引用必须是存在的本地 `#id` 或 `url(#id)`。image可使用png／jpeg／webp的完整base64 data URL。工程不依赖HTTP地址、绝对路径、旁边的文件夹或CDN。为了保证编辑对象边界可理解，use推荐仅复用不含文字、不循环引用的静态几何。

采用SVG显示属性，或以下内联style属性：fill、fill-opacity、fill-rule、stroke、stroke-width、stroke-opacity、stroke-linecap、stroke-linejoin、stroke-dasharray、stroke-dashoffset、opacity、display、visibility、color、font-family、font-size、font-weight、font-style、text-anchor、letter-spacing、dominant-baseline、paint-order、vector-effect。变换用transform属性；不要用CSS transform／transform-origin。

本来源不接受style节点、CSS动画／transition、SMIL animate／animateMotion／animateTransform／set、script、事件处理属性、foreignObject或HTML交互控件。动画只放在animations字段。普通SVG导入可能会清理不支持内容，本协议的动画来源会明确报错，避免误以为动画已保留。

不要自填工作台内部属性：data-original-id、data-node-id、data-layout-id、data-motion-id、data-text-id、data-content、data-signature、data-source-id、data-layer、data-scene、data-ground、data-text。源SVG的id由工作台在DOM中隔离，所有外部绑定仍以原始SVG id为准。

## 基础变换、动画与教师编辑

每个组件的变换顺序是：`教师布局层 × 动画层 × SVG原始变换 × 原始几何`。动画origin使用原始节点父坐标；不能假定它是图形局部中心或屏幕坐标。

例如rect位于x=100、y=100、宽80、高40，且没有基础transform，则绕其中心旋转应使用origin `[140,120]`。父组带有transform时，子组件仍使用父组坐标；工作台处理最终舞台坐标下的框选和批量变换。

---

# 声明式动画接口：svg-keyframes-v1

一个来源的 `animations` 是目标数组；每个SVG目标最多出现一次，多个运动通道放进同一tracks对象。目标必须是画面中登记的可编辑节点，不能指向defs资源。

```json
{
  "target": "moving-group",
  "origin": [140, 120],
  "tracks": {
    "x": [
      {"time": 0, "value": 0, "easing": "ease-in-out"},
      {"time": 2, "value": 240},
      {"time": 3, "value": 240}
    ],
    "opacity": [{"time": 0, "value": 0}, {"time": 0.5, "value": 1}]
  }
}
```

origin可省略，默认 `[0,0]`，两项为±20000内的有限数字。tracks至少包含一个支持通道；未指定通道在任何时间都使用默认值。

| 通道 | 单位与含义 | 默认值 | 合法范围 |
| --- | --- | --- | --- |
| x / y | 目标父坐标中的平移量，叠加于基础布局 | 0 | −20000到20000 |
| scale | 围绕origin的统一缩放倍率 | 1 | 0.001到100 |
| rotation | 围绕origin的旋转角度 | 0 | −36000到36000 |
| opacity | 动画层透明度，与原SVG透明度相乘 | 1 | 0到1 |

每个通道为1–1000个 `{time,value,easing?}` 关键帧；第一个time必须是0，此后严格递增，末项不超过来源duration。time/value必须是JSON数字。每来源总关键帧不超过100000。动画、tracks或关键帧中的未知字段会被拒绝；不要添加循环函数、CSS、JS或自定义效果名。

## 求值规则

- time以秒为单位，始终是来源时间。`in/out/hold`仅改变取哪个来源时刻，不能通过重启动画计时器表示裁剪。
- 两个关键帧之间插值，缓动取**起始关键帧**的easing，缺省linear。准确落在关键帧时得到该帧value；最后一帧后保持末值。
- 对区间归一化进度u（0到1），linear为u；ease-in为u²；ease-out为1−(1−u)²；ease-in-out为前半段2u²、后半段1−(−2u+2)²/2；step在到达后一帧前保持前值。
- rotation按数值线性插值，不自动选择最短转向。0到360表示转整圈；350到10表示反向转340度。如需较短方向，使用350到370。
- 循环、往返、停顿通过明确的关键帧序列描述；本版没有repeat、yoyo、path morph、非均匀缩放、动态颜色或任意脚本接口。
- 平移、origin旋转／缩放、原始SVG变换的矩阵顺序为 `translate(x,y) translate(origin) rotate(rotation) scale(scale) translate(-origin) baseTransform`。

任何时间的结果只由工程和该时间决定。不能依赖播放次数、DOM上一次状态、Date.now、setInterval、随机数或累计增量。教师直接拖到中间、反复往返、剪掉前段或导出任意帧时，必须得到同一姿态。

## 编辑能力边界

工作台提供文字／组件布局、字幕、剪辑和声音编辑；本版不是完整的关键帧曲线编辑器。作者可在JSON中调整动画，教师在工作台调整位置／缩放／旋转／隐藏，二者共存。剪辑重排不自动把全片音轨移到新位置；涉及旁白对应关系时需要同步检查音轨。

---

# Canvas 程序动画接口 · canvas-program-v1

本接口支持保留原生 Canvas 2D 绘制，同时编辑对象、文字和声明的参数。它要求工程 0.4.0；不自动解析普通 HTML，也不把 Canvas 像素当作已有图层。

## 来源结构

在 `sources[sourceId]` 中提供：

| 字段 | 内容 |
| --- | --- |
| type | `canvas-program-v1` |
| duration | 来源时长，秒 |
| canvas | `{width,height}`，来源逻辑画幅，整数 64–4096 |
| program | JavaScript 函数体字符串，返回 `{render(ctx,time,api)}`；最多 1 MiB |
| objects | 最多 2000 个对象声明，允许父子结构 |
| assets | 可选；素材别名到工程 `resources` 编号的映射 |
| fonts | 可选；`[{asset,family,weight?,style?}]`，asset 为已声明的字体别名 |

`program` 支持函数、类、数学计算和 Canvas 2D。不要写 HTML、`import`／`export`、DOM 查询、定时播放或网络请求。大型源码可在文件夹工程中用 `programFile` 指向相对路径，通过打包工具编入 `program`。工作台直接读取的 JSON 必须已经包含 `program`。

示例程序体：

```javascript
return {
  render(ctx, time, api) {
    ctx.fillStyle = '#f3efe4';
    ctx.fillRect(0, 0, api.width, api.height);
    api.object('ball', (c, params) => {
      c.fillStyle = params.color;
      c.beginPath();
      c.arc(100, 150, 30, 0, Math.PI * 2);
      c.fill();
    }, {x: time * 25});
    api.text('title');
  }
};
```

## 对象与参数

每个对象为 `{id,label,bounds,parentId?,text?,parameters?}`：

- `id` 使用稳定 ASCII 编号，与 SVG ID 的规则相同；一个来源内唯一。
- `bounds: [x,y,width,height]` 使用父坐标，宽高为正数；这是基础边界和布局缩放中心。
- `parentId` 引用父对象。绘制时必须在父对象的 `api.object` 内绘制子对象；禁止循环层级。
- `text` 使用工程中的文字字段：`text,x,y,size,font,fill,anchor,width,start,end`。`start/end` 是来源时间；默认 0 至 1e9。文字仍是可编辑正文。
- `parameters` 以稳定参数名为键。每项含 `type,label,default`。`number` 必须有 `min,max`，可含 `step`；`select` 必须有字符串 `options`；其余类型为 `boolean`、`text` 和 `color`，color 使用 `#RRGGBB`。

对象编号映射为 `sourceId:o:objectId`，文字为 `sourceId:t:objectId`。来源声明决定能力：全部对象支持变换与隐藏；提供 text 时支持文字编辑；提供 parameters 时显示参数控件。首次剪辑的 objects／texts 留空，由工作台登记。保存后保留完整清单及编号。

布局修改继续使用 `objectOverrides`。参数修改单独保存在镜头的 `parameterOverrides[对象完整编号][参数名]`，不改写来源程序与默认值。

## 绘制 API

| API | 行为 |
| --- | --- |
| `api.width / height` | 逻辑画幅。勿用 `ctx.canvas.width` 代替，它可能是更高的输出像素分辨率 |
| `api.params(id)` | 当前对象的默认参数与本剪辑修改合并后的只读值 |
| `api.object(id, draw, pose?)` | 绘制可编辑对象；draw 接收 `(ctx, params, time)`，须同步完成 |
| `api.text(id, pose?)` | 按工作台文字记录绘制真实文字，自动换行并报告边界 |
| `api.image(alias)` | 取得已声明图片；工作台按需加载并在资源就绪后重绘，不会把缺图的中间帧交付给预览或导出 |

`pose` 可含 `x,y,scale,rotation,origin:[x,y],opacity,bounds`；rotation 单位为度。也可使用 `matrix:[a,b,c,d,e,f]`，但不能同时提供分量变换。bounds 用于报告该时刻实际的局部边界。布局覆盖在运动之外；不要在程序里再次应用用户的布局修改。

每帧同一个对象只调用一次 object 或 text。可按时间不绘制某对象，未绘制的对象不会被框选。不要将每次绘制的随机数或递增计数当作时间；`render` 必须能够独立渲染任意来源时刻，且正确处理正序、倒序和重复寻帧。

`render` 可以返回 Promise，工作台会等待；不要启动后台动画循环。每次初始化或绘制超过 10 秒会终止该环境并报告错误。单帧解码图片预算 256 MiB；图片最大边 16384，输出画布最大边 4096。字体使用已声明的二进制字体资源或本机可用字体。

## 支持程度

此版本提供 Canvas 2D；规范程序接口不包含DOM或三维；原始目录入口另支持Canvas二维纹理的WebGL后期读取，详见项目docs/07-原始源码目录读取.md。PNG 人物可以换图、变换和切换已有姿态；新增骨骼或图片中未分离的部件仍需来源本身提供结构。复杂图解应将有意义的参数登记到对象，不能用不可见的私有字段冒充可编辑能力。

完整示例随工作台提供：参数化时钟、图片文字卡片、SVG／Canvas 混合时间轴。交付前使用统一校验工具，并实际验证一次文字与对象修改、保存回读、寻帧和短片导出。

---

# 交付、检查与互操作

## 主交付与可选封装

交付自包含 `作品名.svgfilm.json` 或完整 `.prism` 工程包。附上短说明：对应工作台0.4、来源类型、总时长与帧率、是否包含声音、已执行哪些检查。不要只交截图、当前帧SVG、MP4或单独的动画HTML。

- **ZIP／.svgfilm／.prism**：ZIP中放唯一 `project.svgfilm.json`，推荐置于根目录。资源清单通过path关联包内素材，不能只放文件而不登记。包本身及解压总大小不超过4 GiB，JSON清单不超过120 MiB。工作台保存含独立素材的工程时自动生成.prism。
- **HTML**：必须嵌入 `<script id="svgfilm-project" type="application/json">`，内容为同一工程JSON。为避免正文提前关闭script，将JSON中的 `<` 编码为 `\u003c`。工作台仅读取此数据，忽略HTML中的播放脚本。因此“能导入的HTML”不必能独立播放；需要独立播放器时由工作台导出HTML，捆绑其匹配版本运行时。
- **普通.svg**：作为单个静态镜头导入，原扩展名不携带animations数据；动画主交付依然必须是工程。

目录工程可以放 `project.json`、绘制程序和素材；在来源中用 `programFile` 指向程序体文件，在resources中用path指向素材。运行工作台的 `app/tools/package_project.py 工程目录 --out 作品.prism`，工具只读取、核对路径并打包，不执行程序。不要把完整网页HTML直接放入programFile。

独立HTML会携带运行时与允许容量内的素材；过大的工程应保存工程包或导出MP4。当前帧SVG中的Canvas部分是位图快照，后续对象编辑使用原工程。

## 真实校验工具

Skill自带 `scripts/check_project.py`，针对匹配版本的已运行工作台检查JSON或工程包。需要Python的Playwright及可用浏览器；当前工作区可直接使用工作台的 `.venv/Scripts/python.exe`，无需全局安装Skill或依赖。

在项目根目录运行（将路径替换为实际文件）：

```powershell
app/.venv/Scripts/python.exe -X utf8 .agents/skills/svgfilm-authoring/scripts/check_project.py 作品名.svgfilm.json --url http://127.0.0.1:8765 --report 校验结果.json
```

在其他环境可以用具有Playwright的Python运行同一个脚本，并以 `--browser chromium` 使用已安装的Chromium；默认msedge。`--check-portable`额外验证工作台捆绑的离线HTML。工具复用实际工作台的校验、渲染和编辑读写，不要求其他AI获得本次聊天历史或自行重写验证器。

校验不会覆盖输入工程，编辑检查在隔离浏览器中完成。报告区分导入、图片／音频解码与真实音源时长、确定性寻帧、文字／组件修改、保存回读与可选HTML。它不代替人工检查事实内容、字体外观、遮挡、字幕阅读速度，也不声称已经执行MP4导出或人工试听。

## 交付前自检

1. JSON可解析，所有来源和素材完整内嵌或随包提供，版本／来源类型正确；没有伪base64或本机绝对路径。
2. SVG节点或Canvas声明中的对象ID稳定、唯一，文字保留正文，引用存在。初始清单为空，或已有清单保持完整且对应来源。
3. 全片、剪辑、来源三个时钟区分正确。片头、镜头中部、切点、片尾／停留以及逆序寻帧都能渲染。
4. 导入后至少实际修改一段文字与一个组件，保存再导入；修改仍在、原动画仍在，字幕／声音时间没有错位。
5. 需要成片交付时，由工作台实际导出一段MP4，检查动画和声音；再按需求导出全片。工程始终与成片一起保留。

无法运行工作台时，明确写“仅完成静态结构自检，未进行工作台运行验证”。遇到未知动画需求先说明无法由现接口表达的部分，不用字段名看似相似的私有格式冒充兼容。

## 纯提示词模式

不支持Skill的AI可以阅读本项目的单文件《SVGFilm-AI-引导协议.md》，然后接收具体创作需求。该文件包含完整示例，不需要跟随相对链接。使用时说明：“先遵守这份工程协议，再执行我的题材和风格要求；主交付必须包含可编辑的.svgfilm.json。”

Skill协议参考是权威文档来源；单文件由 `python scripts/build_prompt.py --output <目标.md>` 生成，修改规范后重新生成，不分别手工修改两份。

---

# 完整可导入 SVG 示例

这是继续兼容的0.3工程，6秒、两幕、无音轨。可替换图文和关键帧；初始清单由工作台登记。

```json
{
  "schema": "svgfilm-project",
  "schemaVersion": "0.3.0",
  "projectId": "svgfilm-protocol-example",
  "title": "协议示例：组件运动与编辑",
  "canvas": {"width": 960, "height": 540, "fps": 30, "background": "#ffffff"},
  "workflow": {"script": {"status": "needs-review"}},
  "captionStyle": {"size": 24, "font": "sans-serif", "fill": "#263442"},
  "sources": {
    "motion": {
      "type": "svg-keyframes-v1",
      "duration": 3,
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 540\"><text id=\"title\" x=\"60\" y=\"80\" font-family=\"sans-serif\" font-size=\"36\" fill=\"#263442\">组件可以运动，也可以继续编辑</text><g id=\"carrier\" data-object=\"移动组件 A\"><rect id=\"body\" x=\"140\" y=\"200\" width=\"120\" height=\"120\" rx=\"16\" fill=\"#397ab8\"/><text id=\"label\" x=\"200\" y=\"270\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"24\" fill=\"#ffffff\">组件 A</text></g><circle id=\"station\" data-object=\"固定组件 B\" cx=\"770\" cy=\"260\" r=\"60\" fill=\"#ca7848\"/><text id=\"station-label\" x=\"770\" y=\"360\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"24\" fill=\"#263442\">组件 B</text></svg>",
      "animations": [
        {
          "target": "carrier",
          "origin": [200, 260],
          "tracks": {
            "x": [{"time": 0, "value": 0, "easing": "ease-in-out"}, {"time": 2.5, "value": 350}, {"time": 3, "value": 350}],
            "scale": [{"time": 0, "value": 1}, {"time": 2.5, "value": 1.15}],
            "rotation": [{"time": 0, "value": 0}, {"time": 2.5, "value": 12}],
            "opacity": [{"time": 0, "value": 0}, {"time": 0.4, "value": 1}]
          }
        }
      ]
    },
    "summary": {
      "type": "svg-keyframes-v1",
      "duration": 3,
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 540\"><text id=\"title\" x=\"60\" y=\"90\" font-family=\"sans-serif\" font-size=\"36\" fill=\"#263442\">导入后，试着做三项修改</text><text id=\"step-one\" x=\"90\" y=\"210\" font-family=\"sans-serif\" font-size=\"28\" fill=\"#263442\">1. 修改前一幕的标题或组件文字</text><text id=\"step-two\" x=\"90\" y=\"285\" font-family=\"sans-serif\" font-size=\"28\" fill=\"#263442\">2. 移动组件，检查它的动画仍然保留</text><text id=\"step-three\" x=\"90\" y=\"360\" font-family=\"sans-serif\" font-size=\"28\" fill=\"#263442\">3. 调整字幕时间，保存并重新导入</text></svg>",
      "animations": [{"target": "title", "tracks": {"opacity": [{"time": 0, "value": 0}, {"time": 0.4, "value": 1}]}}]
    }
  },
  "scenes": [
    {
      "id": "scene-motion", "sourceId": "motion", "name": "组件运动", "in": 0, "out": 3, "hold": 0,
      "texts": [], "objects": [], "objectOverrides": {},
      "subtitles": [{"id": "motion-caption", "text": "图形、文字和动画分别保留编辑能力。", "start": 0.3, "end": 2.9}]
    },
    {
      "id": "scene-summary", "sourceId": "summary", "name": "手动修改验证", "in": 0, "out": 3, "hold": 0,
      "texts": [], "objects": [], "objectOverrides": {},
      "subtitles": [{"id": "summary-caption", "text": "工程是交付源文件，MP4 是观看成品。", "start": 0.3, "end": 2.9}]
    }
  ],
  "audioTracks": []
}
```

---

# 完整可导入 Canvas 示例

这是0.4程序动画，支持对象变换、文字、颜色与速度参数。

```json
{
  "schema": "svgfilm-project",
  "schemaVersion": "0.4.0",
  "projectId": "canvas-starter",
  "title": "可编辑 Canvas 动画",
  "canvas": { "width": 640, "height": 360, "fps": 24, "background": "#f3efe4" },
  "sources": {
    "demo": {
      "type": "canvas-program-v1",
      "duration": 6,
      "canvas": { "width": 640, "height": 360 },
      "objects": [
        {
          "id": "ball",
          "label": "小球",
          "bounds": [70, 120, 60, 60],
          "parameters": {
            "color": { "type": "color", "label": "颜色", "default": "#315f74" },
            "speed": {
              "type": "number",
              "label": "速度",
              "default": 25,
              "min": 0,
              "max": 60
            }
          }
        },
        {
          "id": "title",
          "label": "标题",
          "bounds": [40, 25, 560, 40],
          "text": {
            "text": "修改文字，调整小球颜色和速度",
            "x": 320,
            "y": 55,
            "size": 26,
            "font": "sans-serif",
            "fill": "#26324f",
            "anchor": "middle",
            "start": 0,
            "end": 6
          }
        }
      ],
      "program": "return {render(ctx,time,api){ctx.fillStyle='#f3efe4';ctx.fillRect(0,0,api.width,api.height);const p=api.params('ball');api.object('ball',(c,p)=>{c.fillStyle=p.color;c.beginPath();c.arc(100,150,30,0,Math.PI*2);c.fill();},{x:time*p.speed});api.text('title');}};"
    }
  },
  "scenes": [
    {
      "id": "one",
      "sourceId": "demo",
      "name": "Canvas 动画",
      "in": 0,
      "out": 6,
      "hold": 0,
      "objects": [],
      "texts": [],
      "objectOverrides": {},
      "subtitles": []
    }
  ],
  "audioTracks": []
}
```

---

# 给生成 AI 的交付要求

请交付工程文件及简短验证说明。保留可编辑文字和稳定ID，采用上述动画字段；没有运行工作台时明确标记未运行验证。用户只需要纯SVG时，可交付可编辑静态素材，但应说明它不等于完整动画工程。
