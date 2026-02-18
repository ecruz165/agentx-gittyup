.PHONY: build test clean install

clean:
	pnpm -r run clean

# Install all workspace dependencies
install:
	pnpm install

build:
	pnpm -r run build

test:
	pnpm -r run test

