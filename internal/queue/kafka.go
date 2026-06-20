package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"keeper/internal/scanner"
	"time"

	"github.com/segmentio/kafka-go"
)

type Kafka struct {
	writer *kafka.Writer
	reader *kafka.Reader
}

func NewKafka(brokers []string, topic string) *Kafka {
	ensureTopic(brokers[0], topic)

	writer := &kafka.Writer{
		Addr:                   kafka.TCP(brokers...),
		Topic:                  topic,
		AllowAutoTopicCreation: true,
	}
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: brokers,
		Topic:   topic,
		GroupID: "keeper",
	})
	return &Kafka{writer: writer, reader: reader}
}

// ensureTopic creates the topic if it doesn't exist, retrying until Kafka is ready.
func ensureTopic(broker, topic string) {
	for attempt := 0; attempt < 20; attempt++ {
		conn, err := kafka.Dial("tcp", broker)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		_ = conn.CreateTopics(kafka.TopicConfig{
			Topic:             topic,
			NumPartitions:     1,
			ReplicationFactor: 1,
		})
		conn.Close()
		return
	}
}

func (q *Kafka) Publish(ctx context.Context, m scanner.Market) error {
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("marshal market: %w", err)
	}
	return q.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(m.ID),
		Value: data,
	})
}

func (q *Kafka) Consume(ctx context.Context) <-chan scanner.Market {
	out := make(chan scanner.Market)

	go func() {
		defer close(out)
		for {
			msg, err := q.reader.FetchMessage(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				fmt.Printf("kafka fetch error: %v\n", err)
				continue
			}

			var m scanner.Market
			if err := json.Unmarshal(msg.Value, &m); err != nil {
				fmt.Printf("kafka unmarshal error: %v\n", err)
				_ = q.reader.CommitMessages(ctx, msg)
				continue
			}

			select {
			case out <- m:
				_ = q.reader.CommitMessages(ctx, msg)
			case <-ctx.Done():
				return
			}
		}
	}()

	return out
}

func (q *Kafka) Close() error {
	_ = q.writer.Close()
	return q.reader.Close()
}
