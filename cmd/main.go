package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"keeper/internal/engine"
	"keeper/internal/protocols/deepbook"
	"keeper/internal/queue"
	"keeper/internal/scanner"
	"keeper/internal/settler"
	"keeper/internal/store"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "store: %v\n", err)
		os.Exit(1)
	}
	if err := st.Migrate(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}

	protocol, err := deepbook.New(
		os.Getenv("SUI_RPC_URL"),
		os.Getenv("SUI_PRIVATE_KEY"),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "protocol: %v\n", err)
		os.Exit(1)
	}

	q := queue.NewKafka([]string{"localhost:9092"}, "markets.expired")
	s := scanner.New(protocol, 30*time.Second)
	set := settler.New(protocol, st, 5)
	e := engine.New(s, q, set)

	fmt.Println("keeper running")
	e.Run(ctx)
	fmt.Println("keeper stopped")
}
