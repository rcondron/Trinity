; Trinity Installer — Inno Setup Script
; Produces TrinitySetup.exe
;
; Build:  iscc.exe trinity.iss
;
; Installs to %LOCALAPPDATA%\Programs\Trinity (per-user, no admin required).
; Same pattern as Ollama's installer.

#define MyAppName "Trinity"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Morpheus AI"
#define MyAppURL "https://mor.org"
#define MyAppExeName "trinity app.exe"

[Setup]
AppId={{B7E4A3F2-9C1D-4E8A-B6F5-2A7D9E3C1B4F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputBaseFilename=TrinitySetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\icon.ico
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Main binaries
Source: "..\dist\windows\trinity app.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\windows\trinity-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion
; WebUI files
Source: "..\..\Trinity-WebUI\*"; DestDir: "{app}\Trinity-WebUI"; Flags: ignoreversion recursesubdirs createallsubdirs
; Icon
Source: "..\assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Registry]
; Add to user PATH
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
  ValueData: "{olddata};{app}"; Check: NeedsAddPath('{app}')
; Register trinity:// URL scheme
Root: HKCU; Subkey: "Software\Classes\trinity"; ValueType: string; ValueName: ""; ValueData: "URL:Trinity Protocol"
Root: HKCU; Subkey: "Software\Classes\trinity"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\trinity\shell\open\command"; ValueType: string; \
  ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Run]
; Launch after install
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Trinity"; \
  Flags: nowait postinstall runhidden

[UninstallRun]
; Kill running processes before uninstall
Filename: "taskkill"; Parameters: "/F /IM ""trinity app.exe"""; Flags: runhidden
Filename: "taskkill"; Parameters: "/F /IM ""trinity-bridge.exe"""; Flags: runhidden

[Code]
// Check if path already contains the app directory
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER,
    'Environment', 'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;
