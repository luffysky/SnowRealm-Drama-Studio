#!/usr/bin/env bash
# 把 assets/brand/ 的設計母片轉成 public/brand/ 實際要送出去的檔案。
#
# 母片是 2–2.8 MB 的 PNG，直接上線等於每個訪客都付那個重量；而且三張的
# 亮部正好落在要疊字的位置（docs/NEEDED_FROM_YOU.md C1–C4 寫的條件沒達到），
# 所以這裡順便做裁切，剩下的壓暗交給 CSS 遮罩——那樣深／淺色模式可以各自調。
#
# 需要 ffmpeg。改母片後重跑這支，不要手改 public/brand/。
set -euo pipefail
cd "$(dirname "$0")/.."
src=assets/brand
out=public/brand
mkdir -p "$out"

webp=(-c:v libwebp -compression_level 6 -preset picture)

# 1. 側欄／favicon 用的雪花紋章。
#    母片是完整 lockup（含文字），32px 下文字只會變雜訊，所以裁出中央雪花，
#    再用圓形 alpha 把四角的拱圈與山景切掉。
ffmpeg -y -v error -i "$src/logo-mark.png" -vf "\
crop=424:424:418:190,scale=512:512,format=rgba,\
geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((0.50-hypot((X-W/2)/W,(Y-H/2)/H))/0.055,0,1)',\
scale=256:256" "${webp[@]}" -quality 92 "$out/mark.webp"

# 同一張紋章給 Next.js 的 app icon 用（PNG，瀏覽器分頁與 iOS 主畫面）。
ffmpeg -y -v error -i "$out/mark.webp" -vf scale=48:48 src/app/icon.png
ffmpeg -y -v error -i "$out/mark.webp" -vf scale=180:180 src/app/apple-icon.png

# 2. 登入頁抬頭用的完整 lockup（這裡文字是要的）。
ffmpeg -y -v error -i "$src/logo-mark.png" -vf "scale=512:512" \
  "${webp[@]}" -quality 88 "$out/lockup.webp"

# 3. 儀表板問候橫幅。母片 2172x724，維持 3:1。
ffmpeg -y -v error -i "$src/hero-banner.png" -vf "scale=1920:640" \
  "${webp[@]}" -quality 76 "$out/hero.webp"

# 4. 登入頁背景。會被壓暗又模糊，畫質不用留太多。
ffmpeg -y -v error -i "$src/login-bg.png" -vf "scale=1600:900" \
  "${webp[@]}" -quality 68 "$out/login.webp"

# 5. 側欄底部裝飾。顯示寬度 ~260px，給 2x。
ffmpeg -y -v error -i "$src/rail-foot.png" -vf "scale=520:293" \
  "${webp[@]}" -quality 74 "$out/rail-foot.webp"

ls -l "$out"
