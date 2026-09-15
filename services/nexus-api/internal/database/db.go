package database

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DBTX defines the minimal database transaction and query execution interface.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

// New creates a new instance of Queries bound to a database connection or pool.
func New(db DBTX) *Queries {
	return &Queries{db: db}
}

// Queries provides typed access to all application database queries.
type Queries struct {
	db DBTX
}

// WithTx returns a new Queries instance bound to the provided transaction.
func (q *Queries) WithTx(tx pgx.Tx) *Queries {
	return &Queries{
		db: tx,
	}
}
