@echo off
cd /d "%~dp0"

"C:\Users\aurel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\extract-fiba-data.py
if errorlevel 1 goto erro

git add .
git commit -m "Atualiza rodada %date% %time%"
git push
if errorlevel 1 goto erro

echo.
echo Site atualizado com sucesso. Aguarde o GitHub Pages publicar.
pause
exit /b 0

:erro
echo.
echo Deu erro na atualizacao. Copie esta tela e mande para o ChatGPT.
pause
exit /b 1
