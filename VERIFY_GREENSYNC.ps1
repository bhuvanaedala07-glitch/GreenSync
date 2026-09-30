$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8000'
Write-Host 'Checking GreenSync backend...' -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod "$base/api/health"
    Write-Host "Health: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host 'Backend is not responding yet. Make sure the FastAPI window is running.' -ForegroundColor Red
    exit 1
}

Write-Host 'Testing priority calculation...' -ForegroundColor Cyan
$body = @{
    fill_level = 90
    severity = 'High'
    location_type = 'Market'
    time_elapsed_mins = 30
    report_count = 2
} | ConvertTo-Json
$priority = Invoke-RestMethod "$base/api/priority/calculate" -Method Post -ContentType 'application/json' -Body $body
Write-Host ("Priority: score={0}, status={1}" -f $priority.score, $priority.priority_status) -ForegroundColor Green

Write-Host 'All basic backend checks passed.' -ForegroundColor Green
