use std::sync::Arc;
use wasm_bindgen::prelude::*;

use omnidb_core::{
    ConnectionConfig, ConnectionManager, DriverCapabilities,
};

static mut MANAGER: Option<Arc<ConnectionManager>> = None;

fn get_manager() -> Arc<ConnectionManager> {
    unsafe {
        if MANAGER.is_none() {
            MANAGER = Some(Arc::new(ConnectionManager::new()));
        }
        MANAGER.as_ref().unwrap().clone()
    }
}

#[wasm_bindgen(start)]
pub fn init_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn wasm_get_capabilities(driver: &str) -> Result<JsValue, JsValue> {
    let caps = match driver.to_lowercase().as_str() {
        "sqlite" => DriverCapabilities::sqlite(),
        "postgres" | "postgresql" => DriverCapabilities::postgres(),
        "mysql" => DriverCapabilities::mysql(),
        "mongodb" => DriverCapabilities::mongodb(),
        other => return Err(JsValue::from_str(&format!("Unknown driver: {}", other))),
    };

    serde_wasm_bindgen::to_value(&caps).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub async fn wasm_connect(config_js: JsValue, password: Option<String>) -> Result<(), JsValue> {
    let config: ConnectionConfig = serde_wasm_bindgen::from_value(config_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid config: {}", e)))?;

    let mgr = get_manager();
    mgr.connect(config, password.as_deref())
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub async fn wasm_execute_query(
    connection_id: String,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<JsValue, JsValue> {
    let mgr = get_manager();
    let result = mgr
        .execute_query(&connection_id, &query, limit, offset)
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
