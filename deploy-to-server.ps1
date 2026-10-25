<#
.SYNOPSIS
    Script de deploy/sincronização do backend local para o servidor de produção Star Orphans.
.DESCRIPTION
    Copia os fontes de apis e auth para o disco Z: e reinicia o container apis_novas.
#>

param(
    [string]$ServerHost = "26.239.180.177",
    [string]$ServerUser = "luizp",
    [string]$DestShare = "Z:\OrphansSolutions"
)

Write-Host ">>> Iniciando sincronização com o servidor ($DestShare)..." -ForegroundColor Cyan

if (-not (Test-Path $DestShare)) {
    Write-Error "O disco de rede $DestShare não está acessível. Verifique a conexão com o servidor."
    exit 1
}

# 1. Sincroniza docker-compose.yml
Copy-Item ".\docker-compose.yml" "$DestShare\" -Force

# 2. Sincroniza pasta apis (ignorando node_modules, public e storage)
Write-Host ">>> Sincronizando apis/src..." -ForegroundColor Yellow
robocopy ".\apis" "$DestShare\apis" /E /XD node_modules public storage .git /NFL /NDL /NJH /NJS

# 3. Sincroniza pasta auth (ignorando node_modules)
Write-Host ">>> Sincronizando auth/src..." -ForegroundColor Yellow
robocopy ".\auth" "$DestShare\auth" /E /XD node_modules .git /NFL /NDL /NJH /NJS

Write-Host ">>> Sincronização de arquivos concluída com sucesso!" -ForegroundColor Green
Write-Host ">>> Para reiniciar o container no servidor execute:" -ForegroundColor Cyan
Write-Host "    ssh $ServerUser@$ServerHost `"docker cp C:\Hyper-V\OrphansSolutions\apis\src\. apis_novas:/usr/src/ && docker restart apis_novas`"" -ForegroundColor White
