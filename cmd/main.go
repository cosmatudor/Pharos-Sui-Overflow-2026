package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"keeper/internal/engine"
	"keeper/internal/indexer"
	"keeper/internal/protocols/deepbook"
	"keeper/internal/queue"
	"keeper/internal/scanner"
	"keeper/internal/settler"
	"keeper/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

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

	rpcURL := os.Getenv("SUI_RPC_URL")

	protocol, err := deepbook.New(
		rpcURL,
		os.Getenv("SUI_PRIVATE_KEY"),
		os.Getenv("KEEPER_REGISTRY_PKG"),
		os.Getenv("KEEPER_REGISTRY_ID"),
		os.Getenv("KEEPER_CREDENTIAL_ID"),
		st,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "protocol: %v\n", err)
		os.Exit(1)
	}

	idx := indexer.New(rpcURL, st)

	brokers := strings.Split(os.Getenv("KAFKA_BROKERS"), ",")
	q := queue.NewKafka(brokers, "markets.redeemable")
	s := scanner.New(protocol, 5*time.Second)
	set := settler.New(protocol, st, 5)
	e := engine.New(s, q, set, st, idx)

	fmt.Println("keeper running")
	e.Run(ctx)
	fmt.Println("keeper stopped")
}
