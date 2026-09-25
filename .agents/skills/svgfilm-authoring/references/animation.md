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
