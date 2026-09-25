from app.api.lectures import missing_indices, parse_uploaded_indices


def test_missing_indices_none_missing():
    assert missing_indices(3, {0, 1, 2}) == []


def test_missing_indices_reports_gaps():
    assert missing_indices(5, {0, 2, 4}) == [1, 3]


def test_missing_indices_all_missing_when_nothing_uploaded():
    assert missing_indices(2, set()) == [0, 1]


def test_missing_indices_ignores_extra_indices_beyond_count():
    assert missing_indices(2, {0, 1, 99}) == []


def _obj(name, size):
    return {"name": name, "metadata": {"size": size}}


def test_parse_uploaded_indices_reads_size_positive_objects():
    objects = [_obj("0000.audio", 1234), _obj("0001.audio", 5678), _obj("0002.audio", 999)]
    assert parse_uploaded_indices(objects) == {0, 1, 2}


def test_parse_uploaded_indices_ignores_zero_size_objects():
    # a zero-byte object means the PUT to the signed URL never actually
    # landed data (e.g. client crashed mid-upload) — must not count as uploaded.
    objects = [_obj("0000.audio", 1234), _obj("0001.audio", 0)]
    assert parse_uploaded_indices(objects) == {0}


def test_parse_uploaded_indices_ignores_non_numeric_names():
    objects = [_obj("0000.audio", 10), _obj(".emptyFolderPlaceholder", 0)]
    assert parse_uploaded_indices(objects) == {0}


def test_complete_flow_reports_missing_when_storage_listing_is_short():
    # Simulates a faked storage listing for a lecture with 5 chunks where the
    # client claims 5 checksums but chunk 2 and 4 never actually landed.
    fake_listing = [_obj(f"{i:04d}.audio", 100) for i in (0, 1, 3)]
    uploaded = parse_uploaded_indices(fake_listing)
    assert missing_indices(5, uploaded) == [2, 4]
