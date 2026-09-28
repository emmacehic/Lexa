# Recreate lexa-whisper with GPU if possible, otherwise CPU.
# Never deletes volumes (model cache + API key live in the whisper data volume).

$ErrorActionPreference = "Stop"

$Name = "lexa-whisper"
$Backup = "lexa-whisper-cpu"
$Model = if ($env:WHISPER_MODEL) { $env:WHISPER_MODEL } else { "base" }
$DataVolume = $null

function Get-WhisperDataVolume([string]$Container) {
  $mounts = docker inspect $Container --format "{{range .Mounts}}{{if eq .Destination `"/var/lib/whisper`"}}{{.Name}}{{end}}{{end}}" 2>$null
  if ($mounts) { return $mounts }
  return "whisper-data"
}

function Start-WhisperCpu([string]$Volume) {
  Write-Host "Starting Whisper on CPU..."
  docker run `
    --name $Name `
    --restart always `
    -p 9000:9000 `
    -v "${Volume}:/var/lib/whisper" `
    -e WHISPER_MODEL=$Model `
    -e WHISPER_DEVICE=cpu `
    -d hwdsl2/whisper-server
}

$existing = docker ps -a --filter "name=^/${Name}$" --format "{{.Names}}"
if ($existing) {
  $DataVolume = Get-WhisperDataVolume $Name
  Write-Host "Keeping data volume: $DataVolume"
  docker stop $Name | Out-Null
  docker rm $Backup 2>$null | Out-Null
  docker rename $Name $Backup
} else {
  $DataVolume = "whisper-data"
}

$gpuOk = $false
try {
  Write-Host "Trying Whisper on GPU (cuda image, device=auto)..."
  docker run `
    --name $Name `
    --restart always `
    --gpus all `
    -p 9000:9000 `
    -v "${DataVolume}:/var/lib/whisper" `
    -e WHISPER_MODEL=$Model `
    -e WHISPER_DEVICE=auto `
    -e WHISPER_COMPUTE_TYPE=float16 `
    -d hwdsl2/whisper-server:cuda | Out-Null
  Start-Sleep -Seconds 4
  $running = docker ps --filter "name=^/${Name}$" --format "{{.Status}}"
  if ($running) {
    $gpuOk = $true
    Write-Host "Whisper is running with GPU (falls back to CPU inside the image if CUDA is unavailable)."
    Write-Host "Previous CPU container kept stopped as $Backup."
  } else {
    throw "GPU container exited"
  }
} catch {
  Write-Host "GPU start failed: $($_.Exception.Message)"
  docker rm -f $Name 2>$null | Out-Null
  $backupExists = docker ps -a --filter "name=^/${Backup}$" --format "{{.Names}}"
  if ($backupExists) {
    Write-Host "Restoring previous CPU container."
    docker rename $Backup $Name
    docker start $Name | Out-Null
  } else {
    Start-WhisperCpu $DataVolume | Out-Null
  }
}

docker exec $Name sh -c "echo DEVICE=\$WHISPER_DEVICE; whisper_manage --getkey" 2>$null
Write-Host "Whisper listening on http://localhost:9000"
