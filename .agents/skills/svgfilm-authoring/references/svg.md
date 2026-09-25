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
