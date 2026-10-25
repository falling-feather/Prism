# 映物品牌资源

当前页面使用的去背景 PNG，与用户选定的 Logo 保持同一图形和文字构成。原稿见 [选定稿](../../../docs/assets/prism-product-concept-v2/logo-approved.png)。

| 文件 | 用途 |
| --- | --- |
| [prism-logo.png](prism-logo.png) | 完整标志，透明背景；用于宽屏页头及仓库 README |
| [prism-mark.png](prism-mark.png) | 独立图形，透明背景；用于窄屏页头及浏览器标签图标 |

网页接入位置：[index.html](../../index.html)、[editor.css](../../src/editor.css)。品牌资源不需要远程图片服务。

## 制作依据

使用内置 image_gen 工具去除背景并提取独立图形，未生成新 Logo 方案。完整标志保留原有中文、英文与标语；独立图形仅保留左侧标志。

完整标志实际提示词：

```text
Edit the provided approved logo image. This is background removal and faithful cleanup for use as an actual production web logo, NOT a redesign.
Preserve exactly the original silhouette, topology, proportions and positions of the solid interlocking green geometric emblem with its diagonal transparent opening, the Chinese wordmark “映物”, the spaced Latin “Prism”, and the small tagline “把道理，映成画面”. Preserve the original deep evergreen color and original type shapes. Remove ONLY the warm off-white / gray background, including background inside all letter counters and the diagonal opening in the mark, to genuinely transparent alpha. Remove any background color fringe with clean antialiased edges. Keep every logo stroke intact. Flat solid evergreen artwork, no background gradient, no shadows, no texture, no added outline or invented elements. Faithfully upscale the small supplied original for crisp webpage display. Keep the wide horizontal lockup composition with tight yet safe transparent padding, approximately original 2:1 aspect. All text exactly as original. Output a transparent PNG.
```

独立图形实际提示词：

```text
Edit the supplied approved transparent logo. Extract ONLY the geometric emblem at the LEFT into its own standalone transparent PNG for favicon and small mobile navigation. Preserve EXACTLY the silhouette and the original topology: two bold evergreen interlocking offset quadrilateral facets, a diagonal transparent gap that slopes down to the right, and the original stepped outer contour. Keep original color and flat treatment. Completely omit all Chinese/Latin lettering and tagline, retaining just the emblem. Center the emblem at a large usable scale on a square transparent canvas with approximately 8% padding all around. Clean antialiased true alpha, including the internal diagonal opening. No redesign, extra stroke, shadows, gradients, checkerboard, background or new symbols.
```
