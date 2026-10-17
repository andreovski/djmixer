// SPDX-License-Identifier: AGPL-3.0-or-later
// Shell Tauri mínimo do spike 4: abre a sondagem do playground no WebView do sistema e grava o
// relatório em PROBE_OUT (ou na saída padrão) antes de fechar.
use std::{env, fs};

#[tauri::command]
fn report(app: tauri::AppHandle, json: String) -> Result<(), String> {
    match env::var("PROBE_OUT") {
        Ok(path) => fs::write(&path, &json).map_err(|e| e.to_string())?,
        Err(_) => println!("{json}"),
    }
    if env::var("PROBE_KEEP_OPEN").is_err() {
        app.exit(0);
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![report])
        .run(tauri::generate_context!())
        .expect("falha ao abrir o shell Tauri");
}
