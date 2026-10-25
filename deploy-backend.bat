@echo off
setlocal EnableDelayedExpansion

echo =======================================================
echo    STAR ORPHANS - DEPLOY AUTOMATIZADO DO BACKEND
echo =======================================================
echo.

REM 1. Deteccao automatica da pasta do backend
set "BACKEND_DIR=%~dp0"
if "%BACKEND_DIR:~-1%"=="\" set "BACKEND_DIR=%BACKEND_DIR:~0,-1%"

if exist "%BACKEND_DIR%\apis\src" goto :FOUND
if exist "C:\projetos\star_orphans_backend\apis\src" (
    set "BACKEND_DIR=C:\projetos\star_orphans_backend"
    goto :FOUND
)
if exist "%USERPROFILE%\star_orphans_backend\apis\src" (
    set "BACKEND_DIR=%USERPROFILE%\star_orphans_backend"
    goto :FOUND
)

echo [ERRO] Nao foi possivel encontrar a pasta do backend!
goto :END

:FOUND
echo [OK] Pasta local identificada: "%BACKEND_DIR%"

REM 2. Verificacao do disco Z:
set "DEST_DIR=Z:\OrphansSolutions"
if not exist "%DEST_DIR%" (
    echo [ERRO] O disco de rede Z:\OrphansSolutions nao esta acessivel!
    echo Verifique se a pasta compartilhada do servidor esta mapeada como Z:.
    goto :END
)
echo [OK] Disco do servidor Z: conectado!

REM 3. Sincronizacao dos arquivos para o servidor via robocopy
echo.
echo [1/3] Sincronizando docker-compose.yml...
copy /y "%BACKEND_DIR%\docker-compose.yml" "%DEST_DIR%\" >nul

echo [2/3] Sincronizando apis/src (preservando uploads e web)...
robocopy "%BACKEND_DIR%\apis" "%DEST_DIR%\apis" /E /XD node_modules public storage .git /NFL /NDL /NJH /NJS /nc /ns /np

echo [3/3] Sincronizando auth/src...
robocopy "%BACKEND_DIR%\auth" "%DEST_DIR%\auth" /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np

echo.
echo [OK] Arquivos sincronizados no servidor com sucesso!

REM 4. Reinicializacao automatica do container apis_novas via SSH
echo.
echo Atualizando e reiniciando o container apis_novas no servidor...

set "SERVER_IP=192.168.15.19"
ping -n 1 -w 500 192.168.15.19 >nul 2>&1
if errorlevel 1 (
    set "SERVER_IP=26.239.180.177"
)
echo Conectando via SSH em !SERVER_IP!...

set "TEMP_ASKPASS=%TEMP%\askpass_orphans.bat"
echo @echo wizard@321> "%TEMP_ASKPASS%"
set "SSH_ASKPASS=%TEMP_ASKPASS%"
set "SSH_ASKPASS_REQUIRE=force"

ssh.exe -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null luizp@!SERVER_IP! "docker cp C:\Hyper-V\OrphansSolutions\apis\src\. apis_novas:/usr/src/ && docker restart apis_novas"
if exist "%TEMP_ASKPASS%" del "%TEMP_ASKPASS%" >nul 2>&1

echo.
echo =======================================================
echo    DEPLOY DO BACKEND CONCLUIDO COM SUCESSO!
echo =======================================================
echo.

:END
