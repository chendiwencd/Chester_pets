use rusqlite::{params, Connection, OptionalExtension, Result};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::state::{ClipboardHistoryItem, SavedResourceInput};

const MAX_HISTORY: i64 = 100;

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(app: &AppHandle) -> Result<Self> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)))?;
        std::fs::create_dir_all(&directory)
            .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)))?;

        let path = directory.join("content.sqlite3");
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS history_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                value TEXT NOT NULL,
                preview TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                pinned_at_ms INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_history_items_created
                ON history_items(created_at_ms);

            CREATE TABLE IF NOT EXISTS resources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                history_item_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                path TEXT,
                summary TEXT,
                extracted_text TEXT,
                remote_file_id TEXT,
                size_bytes INTEGER,
                mime_type TEXT,
                extension TEXT,
                width INTEGER,
                height INTEGER,
                sort_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(history_item_id) REFERENCES history_items(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_resources_history_item
                ON resources(history_item_id, sort_order);
            ",
        )?;
        ensure_resource_column(&connection, "extracted_text")?;
        ensure_resource_column(&connection, "remote_file_id")?;

        Ok(Self { connection })
    }

    pub fn load_history(&self) -> Result<Vec<ClipboardHistoryItem>> {
        let mut statement = self.connection.prepare(
            "
            SELECT id, kind, value, preview, created_at_ms, pinned, pinned_at_ms
            FROM history_items
            ORDER BY id ASC
            ",
        )?;

        let rows = statement.query_map([], history_item_from_row)?;
        let mut history: Vec<ClipboardHistoryItem> = rows.collect::<Result<Vec<_>>>()?;
        for item in &mut history {
            item.resources = load_resources(&self.connection, item.id)?;
        }
        Ok(history)
    }

    pub fn insert_history(
        &mut self,
        kind: &str,
        value: &str,
        preview: &str,
        created_at_ms: u64,
        resources: &[SavedResourceInput],
    ) -> Result<(ClipboardHistoryItem, bool)> {
        let transaction = self.connection.transaction()?;
        let existing = transaction
            .query_row(
                "
                SELECT id, kind, value, preview, created_at_ms, pinned, pinned_at_ms
                FROM history_items
                WHERE kind = ?1 AND value = ?2
                LIMIT 1
                ",
                params![kind, value],
                history_item_from_row,
            )
            .optional()?;

        if let Some(item) = existing {
            if !resources.is_empty() {
                transaction.execute(
                    "DELETE FROM resources WHERE history_item_id = ?1",
                    params![item.id as i64],
                )?;
                insert_resources(&transaction, item.id, resources)?;
            }
            let mut item = item;
            item.resources = load_resources(&transaction, item.id)?;
            transaction.commit()?;
            return Ok((item, false));
        }

        transaction.execute(
            "
            INSERT INTO history_items(kind, value, preview, created_at_ms, pinned, pinned_at_ms)
            VALUES (?1, ?2, ?3, ?4, 0, NULL)
            ",
            params![kind, value, preview, created_at_ms as i64],
        )?;
        let id = transaction.last_insert_rowid();

        insert_resources(&transaction, id as u64, resources)?;

        while transaction.query_row("SELECT COUNT(*) FROM history_items", [], |row| {
            row.get::<_, i64>(0)
        })? > MAX_HISTORY
        {
            let deleted = transaction.execute(
                "
                DELETE FROM history_items
                WHERE id = (
                    SELECT id
                    FROM history_items
                    WHERE pinned = 0
                    ORDER BY created_at_ms ASC, id ASC
                    LIMIT 1
                )
                ",
                [],
            )?;
            if deleted == 0 {
                break;
            }
        }

        transaction.commit()?;
        Ok((
            ClipboardHistoryItem {
                id: id as u64,
                kind: kind.to_string(),
                value: value.to_string(),
                preview: preview.to_string(),
            created_at_ms,
            pinned: false,
            pinned_at_ms: None,
            resources: resources.to_vec(),
        },
            true,
        ))
    }

    pub fn delete_history(&mut self, id: u64) -> Result<bool> {
        Ok(self.connection.execute(
            "DELETE FROM history_items WHERE id = ?1",
            params![id as i64],
        )? > 0)
    }

    pub fn clear_history(&mut self) -> Result<()> {
        self.connection.execute("DELETE FROM history_items", [])?;
        Ok(())
    }

    pub fn toggle_pin(
        &mut self,
        id: u64,
        pinned_at_ms: u64,
    ) -> Result<Option<ClipboardHistoryItem>> {
        let current = self
            .connection
            .query_row(
                "
                SELECT id, kind, value, preview, created_at_ms, pinned, pinned_at_ms
                FROM history_items
                WHERE id = ?1
                ",
                params![id as i64],
                history_item_from_row,
            )
            .optional()?;
        let Some(current) = current else {
            return Ok(None);
        };

        let pinned = !current.pinned;
        self.connection.execute(
            "
            UPDATE history_items
            SET pinned = ?1, pinned_at_ms = ?2
            WHERE id = ?3
            ",
            params![
                if pinned { 1 } else { 0 },
                if pinned {
                    Some(pinned_at_ms as i64)
                } else {
                    None
                },
                id as i64
            ],
        )?;

        self.connection
            .query_row(
                "
                SELECT id, kind, value, preview, created_at_ms, pinned, pinned_at_ms
                FROM history_items
                WHERE id = ?1
                ",
                params![id as i64],
                history_item_from_row,
            )
            .map(Some)
    }

    pub fn update_history_item(
        &mut self,
        id: u64,
        value: &str,
        preview: &str,
    ) -> Result<Option<ClipboardHistoryItem>> {
        let exists = self
            .connection
            .query_row(
                "SELECT 1 FROM history_items WHERE id = ?1",
                params![id as i64],
                |_| Ok(()),
            )
            .optional()?;

        if exists.is_none() {
            return Ok(None);
        }

        self.connection.execute(
            "UPDATE history_items SET value = ?1, preview = ?2 WHERE id = ?3",
            params![value, preview, id as i64],
        )?;

        let mut updated = self
            .connection
            .query_row(
                "
                SELECT id, kind, value, preview, created_at_ms, pinned, pinned_at_ms
                FROM history_items
                WHERE id = ?1
                ",
                params![id as i64],
                history_item_from_row,
            )?;

        updated.resources = load_resources(&self.connection, id)?;
        Ok(Some(updated))
    }
}

fn ensure_resource_column(connection: &Connection, column: &str) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(resources)")?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }

    let sql = match column {
        "extracted_text" | "remote_file_id" => {
            format!("ALTER TABLE resources ADD COLUMN {column} TEXT")
        }
        _ => return Err(rusqlite::Error::InvalidParameterName(column.to_string())),
    };
    connection.execute(&sql, [])?;
    Ok(())
}

fn history_item_from_row(row: &rusqlite::Row<'_>) -> Result<ClipboardHistoryItem> {
    Ok(ClipboardHistoryItem {
        id: row.get::<_, i64>(0)? as u64,
        kind: row.get(1)?,
        value: row.get(2)?,
        preview: row.get(3)?,
        created_at_ms: row.get::<_, i64>(4)? as u64,
        pinned: row.get::<_, i64>(5)? != 0,
        pinned_at_ms: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
        resources: Vec::new(),
    })
}

fn insert_resources(
    transaction: &rusqlite::Transaction<'_>,
    history_item_id: u64,
    resources: &[crate::state::SavedResourceInput],
) -> Result<()> {
    for (sort_order, resource) in resources.iter().enumerate() {
        transaction.execute(
            "
            INSERT INTO resources(
                history_item_id, kind, name, path, summary, extracted_text,
                remote_file_id, size_bytes, mime_type, extension, width, height, sort_order
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ",
            params![
                history_item_id as i64,
                resource.kind,
                resource.name,
                resource.path,
                resource.summary,
                resource.extracted_text,
                resource.remote_file_id,
                resource.size_bytes.map(|value| value as i64),
                resource.mime_type,
                resource.extension,
                resource.width.map(|value| value as i64),
                resource.height.map(|value| value as i64),
                sort_order as i64,
            ],
        )?;
    }
    Ok(())
}

fn load_resources(
    connection: &Connection,
    history_item_id: u64,
) -> Result<Vec<crate::state::SavedResourceInput>> {
    let mut statement = connection.prepare(
        "
        SELECT kind, name, path, summary, extracted_text, remote_file_id,
               size_bytes, mime_type, extension, width, height
        FROM resources
        WHERE history_item_id = ?1
        ORDER BY sort_order ASC, id ASC
        ",
    )?;
    let rows = statement.query_map(params![history_item_id as i64], |row| {
        Ok(crate::state::SavedResourceInput {
            kind: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            summary: row.get(3)?,
            extracted_text: row.get(4)?,
            remote_file_id: row.get(5)?,
            size_bytes: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
            mime_type: row.get(7)?,
            extension: row.get(8)?,
            width: row.get::<_, Option<i64>>(9)?.map(|value| value as u32),
            height: row.get::<_, Option<i64>>(10)?.map(|value| value as u32),
        })
    })?;
    rows.collect()
}

pub fn database_mut<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut Database) -> Result<T>,
) -> Result<T> {
    let state = app.state::<crate::state::AppState>();
    let mut database = state.database.lock().unwrap();
    let database = database.as_mut().ok_or_else(|| {
        rusqlite::Error::InvalidParameterName("database is not initialized".to_string())
    })?;
    operation(database)
}
