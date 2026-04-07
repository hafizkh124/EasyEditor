import urllib.request
import urllib.error
import os

files_to_download = {
    r"D:\EEData\tanzil\quran-simple.txt": "https://tanzil.net/pub/download/quran-simple.txt",
    r"D:\EEData\tanzil\en.sahih.txt": "https://tanzil.net/trans/en.sahih",
    r"D:\EEData\openiti\OpenITI_metadata.tsv": "https://raw.githubusercontent.com/OpenITI/Release/master/meta/OpenITI_metadata_light.csv" # Most releases use the CSV/TSV format here.
}

def download_file(url, path):
    try:
        print(f"Downloading {url} \n  -> {path} ...")
        # adding user-agent to bypass basic bot block
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(path, 'wb') as f:
            f.write(response.read())
        print("Success.")
    except Exception as e:
        print(f"Failed to download {url}: {e}")

if __name__ == "__main__":
    for path, url in files_to_download.items():
        if not os.path.exists(path):
            download_file(url, path)
        else:
            print(f"File already exists: {path}")
            
    print("\n--- Done fetching direct links ---")
