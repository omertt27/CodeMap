from .models import User
from pkg.utils import helper
import os

class App:
    def run(self):
        return User()

def main():
    App().run()
