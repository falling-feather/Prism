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
