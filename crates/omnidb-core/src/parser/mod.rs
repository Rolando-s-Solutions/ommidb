use sqlparser::ast::{Statement, SetExpr};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParserError {
    #[error("SQL syntax parsing error: {0}")]
    SyntaxError(String),
    #[error("Mutation query rejected in read-only mode: detected {0}")]
    ReadOnlyViolation(String),
}

pub struct QueryGuard;

impl QueryGuard {
    /// Validates whether a SQL query consists strictly of read-only statements (SELECT / EXPLAIN / SHOW).
    pub fn assert_read_only(sql: &str) -> Result<(), ParserError> {
        let dialect = GenericDialect {};
        let statements = Parser::parse_sql(&dialect, sql)
            .map_err(|e| ParserError::SyntaxError(e.to_string()))?;

        for stmt in statements {
            match stmt {
                Statement::Query(query) => {
                    // Check if query is a pure SELECT/Values/etc.
                    match *query.body {
                        SetExpr::Select(_) | SetExpr::Values(_) => continue,
                        _ => return Err(ParserError::ReadOnlyViolation("Non-standard query body".into())),
                    }
                }
                Statement::Explain { .. } => continue,
                Statement::ShowVariable { .. }
                | Statement::ShowVariables { .. }
                | Statement::ShowColumns { .. }
                | Statement::ShowTables { .. } => continue,
                other => {
                    let stmt_name = format!("{:?}", other);
                    let simple_name = stmt_name.split('(').next().unwrap_or("Mutation");
                    return Err(ParserError::ReadOnlyViolation(simple_name.to_string()));
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_only_allowed() {
        assert!(QueryGuard::assert_read_only("SELECT id, name FROM users WHERE id = 1;").is_ok());
        assert!(QueryGuard::assert_read_only("EXPLAIN SELECT count(*) FROM orders;").is_ok());
    }

    #[test]
    fn test_read_only_blocks_mutations() {
        assert!(QueryGuard::assert_read_only("DELETE FROM users WHERE id = 1;").is_err());
        assert!(QueryGuard::assert_read_only("DROP TABLE users;").is_err());
        assert!(QueryGuard::assert_read_only("UPDATE accounts SET balance = 0;").is_err());
        assert!(QueryGuard::assert_read_only("INSERT INTO audit VALUES (1);").is_err());
    }
}
