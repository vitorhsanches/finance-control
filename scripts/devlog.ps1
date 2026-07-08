param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$expectedEmail1 = "vitorhsanchesz@gmail.com"
$expectedEmail2 = "110067551+vitorhsanches@users.noreply.github.com"

$currentBranch = git branch --show-current
$currentEmail = git config user.email
$currentName = git config user.name

if ($currentBranch -ne "main") {
    Write-Error "Você não está na branch main. Branch atual: $currentBranch"
    exit 1
}

if ($currentEmail -ne $expectedEmail1 -and $currentEmail -ne $expectedEmail2) {
    Write-Error "E-mail do Git não está correto: $currentEmail"
    exit 1
}

if ($currentName -ne "vitorhsanches") {
    Write-Error "Nome do Git não está correto: $currentName"
    exit 1
}

$devlogPath = "docs/devlog.md"

if (!(Test-Path "docs")) {
    New-Item -ItemType Directory -Path "docs" | Out-Null
}

if (!(Test-Path $devlogPath)) {
    "# Fina Sync Devlog`n" | Out-File -FilePath $devlogPath -Encoding utf8
}

$date = Get-Date -Format "yyyy-MM-dd HH:mm"

"`n## $date`n- $Message" | Add-Content -Path $devlogPath -Encoding utf8

git add $devlogPath
git commit -m "docs: update development log"
git push origin main

git log -1 --pretty=format:"%an <%ae>"