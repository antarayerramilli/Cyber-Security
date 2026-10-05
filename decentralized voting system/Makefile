.PHONY: test serve demo clean keygen

test:
	pytest -v

serve:
	python3 -m openballot.cli serve --port 8000 --difficulty 1

demo:
	python3 scripts/setup_election.py

clean:
	rm -rf __pycache__ */__pycache__ .pytest_cache *.json
